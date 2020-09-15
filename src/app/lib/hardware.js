import analytics from 'app/lib/analytics';
import {
    MASLOW,
    MARLIN,
} from 'app/constants';

class Hardware {
    constructor(controllerType, controllerSettings = {}) {
        this._controllerType = controllerType;
        this.updateControllerSettings(controllerSettings);
    }

    updateControllerSettings(controllerSettings) {
        if (typeof controllerSettings !== 'object') {
            return;
        }

        const hadFirmware = this.hasFirmware;
        this.firmware = controllerSettings.firmware || {};
        this.firmwareStr = this._getVersionStr('firmware', this.firmware);
        if (this.hasFirmware && !hadFirmware) {
            analytics.event({
                category: 'controller',
                action: 'firmware',
                label: this.firmwareStr,
            });
        }

        const hadProtocol = this.hasProtocol;
        this.protocol = controllerSettings.protocol || {};
        this.protocolStr = this._getVersionStr('protocol', this.protocol);
        if (this.hasProtocol && !hadProtocol) {
            analytics.event({
                category: 'controller',
                action: 'protocol',
                label: this.protocolStr,
            });
        }
    }

    get controllerType() {
        return this._controllerType;
    }

    // For a firmware or protocol object, combine name & version into a string & set dimensions.
    _getVersionStr(key, values) {
        const name = values.name && values.name.length > 0 ? values.name : '?';
        const vers = values.version && values.version.length > 0 ? values.version : '?';
        analytics.set({
            [`${key}Name`]: name,
            [`${key}Version`]: vers,
        });
        return `${name} v${vers}`;
    }

    get hasFirmware() {
        return this.firmware && this.firmware.name && this.firmware.version;
    }

    get hasProtocol() {
        return this.protocol && this.protocol.name && this.protocol.version;
    }

    // Is this firmware valid for the machine running on the current Makerverse?
    get isValid() {
        const fstr = `${this.firmwareStr} ${this.protocolStr}`.toLowerCase();
        return fstr.includes(this._controllerType.toLowerCase());
    }

    get updateLink() {
        let section = '';
        if (this.controllerType === MASLOW) {
            section = 'cnc/#maslow';
        } else if (this.controllerType === MARLIN) {
            section = '3dp/';
        } else {
            section = 'cnc/';
        }
        return `http://www.makerverse.com/machines/${section}`;
    }
}

export default Hardware;