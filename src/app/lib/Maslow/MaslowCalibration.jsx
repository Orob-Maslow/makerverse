import log from 'app/lib/log';
import MaslowKinematics from './MaslowKinematics';

const calibrationDefaults = {
    safeTravel: 3,
    motorXAccuracy: 5,
    motorYAccuracy: 5,
    chainBounds: 5,
    edgeDistance: 0,
    cutEdgeDistance: 25.4,
    origChainLength: 1790,
    measuredInches: false,
    cutDepth: 3,
    cutHoles: false,
};

const sled = { type: 'Standard Circle' };

const sleds = {
    'Standard Circle': { top: 9 * 25.4, left: 9 * 25.4, right: 9 * 25.4, bottom: 9 * 25.4, desc: '18 inch diameter circle' },
    'MetalMaslow': { top: 6.325 * 25.4, left: 7.325 * 25.4, right: 7.325 * 25.4, bottom: 8.325 * 25.4, desc: '14.64 inch square, off-center' },
    'Custom': { top: 9 * 25.4, left: 9 * 25.4, right: 9 * 25.4, bottom: 9 * 25.4, desc: 'Enter your own measurements' },
};

export {
    sled,
    sleds
};

/**
 * Implements "Edge Calibration" for Maslow, derivative of HoleyCalibration.
 */
class MaslowCalibration {
    opts = {};

    static setSledType(st) {
        sled.type = st;
    }

    constructor(controller, opts) {
        this.controller = controller;
        this.kin = new MaslowKinematics(controller);
        this.update({ ...calibrationDefaults, ...(opts || {}) });
    }

    loadControllerSettings(controllerSettings) {
        this.kin.loadControllerSettings(controllerSettings);
    }

    update(opts) {
        this.opts = { ...this.opts, ...opts };
        this.recomputeIdeals();
    }

    recomputeIdeals() {
        this.idealCoordinates = this.calculateIdealCoordinates();
        this.idealChainLengths = this.calculateChainLengths(this.idealCoordinates);
    }

    calibrate(measurements, callback) {
        log.debug('calibrating...');
        const xError = this.calculateXError(measurements);
        const measured = this.calculateMeasurementCoordinates(measurements, xError);
        const ret = this._calibrate(measured, callback);
        ret.xError = xError;
        return ret;
    }

    _calibrate(measured, callback) {
        const origSettings = {
            leftChainTolerance: this.kin.opts.leftChainTolerance || 0,
            rightChainTolerance: this.kin.opts.rightChainTolerance || 0,
            distBetweenMotors: this.kin.opts.distBetweenMotors,
            motorOffsetY: this.kin.opts.motorOffsetY,
        };
        const origErr = this.calculateError(measured, this.idealCoordinates);
        const orig = { ...origSettings, ...origErr };

        let op = orig;
        const decimals = 4;
        for (let i = 0; i < decimals; i++) {
            log.debug('calibration #', i);
            op = this.optimize(measured, op, i, decimals, callback);
        }

        const change = this.calculateChange(orig, op);

        return {
            orig: orig,
            change: change,
            improvementPercent: {
                avgErrDist: this.round(-change.avgErrDist / orig.avgErrDist * 100, 2),
                maxErrDist: this.round(-change.maxErrDist / orig.maxErrDist * 100, 2),
            },
            optimized: op,
        };
    }

    // First pass calibration. After setting chains, user is told to move the sled to origin.
    // X/Y offset point is passed in.
    calibrateOrigin(homePoint, offsetFromOrigin) {
        const chainBounds = this.opts.chainBounds;
        const measured = [homePoint, offsetFromOrigin];
        this.idealCoordinates = [homePoint, { x: 0, y: 0 }];
        this.idealChainLengths = this.calculateChainLengths(this.idealCoordinates);
        this.opts.chainBounds = 0;
        const ret = this._calibrate(measured);
        this.opts.chainBounds = chainBounds;
        this.recomputeIdeals();
        return ret;
    }

    calculateXError(measurements) {
        if (measurements.length < 10) {
            return 0;
        }
        const tr = measurements[2];
        const br = measurements[3];
        const bl = measurements[7];
        const tl = measurements[8];
        const left = Math.round((bl + tl) / 2);
        const right = Math.round((tr + br) / 2);
        const lneg = left < 0;
        const rneg = right < 0;
        if (lneg === rneg) {
            // If both have the same sign, there cannot be an error
            return 0;
        }
        // Return the mm adjustment needed to center the stock.
        return Math.min(Math.abs(left), Math.abs(right)) * (lneg ? 1 : -1);
    }

    optimize(measured, start, i, decimals, callback) {
        const precision = 1.0 / Math.pow(10, i);
        const percentMult = (i + 1) / decimals;
        const percentAdd = percentMult * i;
        const chainBounds = this.opts.chainBounds;
        let mxBounds = Math.min(this.opts.motorXAccuracy, 1), myBounds = Math.min(this.opts.motorYAccuracy, 1);
        if (precision > 0.01) {
            mxBounds = this.opts.motorXAccuracy;
            myBounds = this.opts.motorYAccuracy;
        }
        const iters = (mxBounds * 2) * (myBounds * 2) * (chainBounds * 2) * (chainBounds * 2);
        const step = chainBounds > 0 ? (precision / chainBounds) : 0;
        let idx = 0;
        let best = { ...start };

        for (let mw = -mxBounds; mw <= mxBounds; mw++) {
            for (let mh = -myBounds; mh <= myBounds; mh++) {
                for (let left = -chainBounds; left <= chainBounds; left++) {
                    for (let right = -chainBounds; right <= chainBounds; right++) {
                        const opt = this.calculateOptimization(
                            measured,
                            start.leftChainTolerance + left * step,
                            start.rightChainTolerance + right * step,
                            start.motorOffsetY + mh,
                            start.distBetweenMotors + mw
                        );
                        if (!opt) {
                            log.warn('Failed to compute location', left, right, mh, mw);
                        }
                        if (opt.maxErrDist < best.maxErrDist && opt.totalErrDist <= best.totalErrDist) {
                            log.debug('new best', opt, 'change=', this.calculateChange(best, opt));
                            best = opt;
                        }
                        idx++;
                    }
                }
                const percent = Math.round(((idx / iters) * percentMult + percentAdd) * 100);
                if (callback) {
                    callback(percent);
                }
            }
        }
        return best;
    }

    calculateChange(orig, op) {
        const change = {};
        Object.keys(orig).forEach((k) => {
            change[k] = this.round(op[k] - orig[k]);
        });
        return change;
    }

    calculateOptimization(measured, leftChainTolerance, rightChainTolerance, motorOffsetY, distBetweenMotors) {
        const opt = {
            leftChainTolerance: this.round(leftChainTolerance),
            rightChainTolerance: this.round(rightChainTolerance),
            distBetweenMotors: this.round(distBetweenMotors),
            motorOffsetY: this.round(motorOffsetY),
        };
        this.kin.recomputeGeometry(opt);
        const points = [];
        for (let x = 0; x < this.idealChainLengths.length; x++) {
            const cl = this.idealChainLengths[x];
            const p = this.kin.chainToPosition(cl[0], cl[1], measured[x].x, measured[x].y);
            if (!p) {
                // Position would not be within bounds. Ignore the possibility.
                return false;
            }
            points.push(p);
        }
        return { ...opt, ...this.calculateError(measured, points) };
    }

    calculateError(measured, points) {
        const opt = {
            totalErrDist: 0,
            maxErrDist: 0,
        };
        for (let i = 0; i < measured.length; i++) {
            const d = this.dist(measured[i], points[i]);
            opt.totalErrDist += d;
            opt.maxErrDist = Math.max(opt.maxErrDist, this.round(d));
        }
        opt.totalErrDist = this.round(opt.totalErrDist);
        opt.avgErrDist = this.round(opt.totalErrDist / measured.length);
        return opt;
    }

    dist(p1, p2) {
        const x = Number(p1.x) - Number(p2.x);
        const y = Number(p1.y) - Number(p2.y);
        return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
    }

    round(v, dec = 6) {
        const factor = Math.pow(10, dec);
        return Math.round(v * factor) / factor;
    }

    get sledDimensions() {
        if (this.opts.cutHoles) {
            return { top: 0, left: 0, bottom: 0, right: 0 };
        }
        return sleds[sled.type];
    }

    calculateMeasurementCoordinates(ms, xError) {
        const mm = this.opts.measuredInches ? 25.4 : 1;
        const h = this.kin.opts.machineHeight;
        const w = this.kin.opts.machineWidth;
        const s = this.sledDimensions;
        return [
            { x: (xError), y: (h / 2 - ms[0] * mm - s.top) },
            { x: xError + (w / 2 - ms[2] * mm - s.right), y: (h / 2 - ms[1] * mm - s.top) },
            { x: xError + (w / 2 - ms[3] * mm - s.right), y: (ms[4] * mm + s.bottom - h / 2) },
            { x: (xError), y: (ms[5] * mm + s.bottom - h / 2) },
            { x: xError + (ms[7] * mm + s.left - w / 2), y: (ms[6] * mm + s.bottom - h / 2) },
            { x: xError + (ms[8] * mm + s.left - w / 2), y: (h / 2 - ms[9] * mm - s.top) },
        ];
    }

    calculateIdealCoordinates() {
        const ed = this.opts.cutHoles ? this.opts.cutEdgeDistance : this.opts.edgeDistance;
        const s = this.sledDimensions;
        const aH1x = (this.kin.opts.machineWidth / 2.0 - ed);
        const aH1y = (this.kin.opts.machineHeight / 2.0 - ed);
        return [
            { x: 0, y: aH1y - s.top },
            { x: aH1x - s.right, y: aH1y - s.top },
            { x: aH1x - s.right, y: -aH1y + s.bottom },
            { x: 0, y: -aH1y + s.bottom },
            { x: -aH1x + s.left, y: -aH1y + s.bottom },
            { x: -aH1x + s.left, y: aH1y - s.top },
        ];
    }

    calculateChainLengths(points) {
        const ret = [];
        for (let x = 0; x < points.length; x++) {
            const cl = this.kin.positionToChain(points[x].x, points[x].y);
            ret.push(cl);
        }
        return ret;
    }

    generateGcodePoint(pointIndex, gcode = ['G21', 'G90']) {
        const p = this.idealCoordinates[pointIndex];
        const mpos = this.controller.state.status.mpos;
        const wpos = this.controller.state.status.wpos;
        if (this.dist(mpos, wpos) >= 0.1) {
            // Set WPos = MPos when they differ.
            gcode.push(`G10 L20 P1 X${mpos.x} Y${mpos.y}`);
        }
        if (this.opts.cutHoles) {
            gcode.push(`G0 Z${this.opts.safeTravel}`);
        }
        gcode.push(`G0 X${p.x} Y${p.y}`);
        if (this.opts.cutHoles) {
            gcode.push(`G0 Z-${this.opts.cutDepth}`);
            gcode.push(`G0 Z${this.opts.safeTravel}`);
        }
        if (this.opts.measuredInches) {
            gcode.push('G20');
        }
        return gcode;
    }

    generateBottomMiddlePoint() {
        return this.generateGcodePoint(3);
    }

    generateGcode() {
        const ret = ['G21', 'G90'];
        for (let i = 0; i < this.idealCoordinates.length; i++) {
            this.generateGcodePoint(i, ret);
        }
        ret.push('G0 X0 Y0');
        return ret;
    }
}

export default MaslowCalibration;
