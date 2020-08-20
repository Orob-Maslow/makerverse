#!/bin/bash
# https://medium.com/@quentin.mcgaw/cross-architecture-docker-builds-with-travis-ci-arm-s390x-etc-8f754e20aaef

BUILD_PLATFORMS=${DOCKER_BUILD_PLATFORMS:-linux/amd64,linux/arm64,linux/arm/v7}
DOCKER_REPO="$DOCKER_USER/makerverse"

if [ "$TRAVIS_PULL_REQUEST" = "false" ] && [ "$TRAVIS_BRANCH" = "master" ]; then
  if [ "$1" != "deploy" ]; then
    # Master branch has a deploy step. Others use the build as the deploy.
    echo "Skipping Docker build until deploy step."
    exit 0
  fi
  TAG="latest"
else
  TAG="ci"
fi

echo "Building $DOCKER_REPO:$TAG for $BUILD_PLATFORMS"

# Login to Docker
echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin &> /dev/null

# n.b., this ALWAYS pushes the resulting image. This is because the --load flag does not
# support multi-arch. https://github.com/docker/buildx/issues/59
docker buildx build --push "--platform=$BUILD_PLATFORMS" -t "$DOCKER_REPO:$TAG" .
if [ $? -eq 0 ]; then
  echo "Docker build succeded."
else
  exit 1
fi

if [[ ! -z "$TRAVIS_TAG" ]]; then
  # If there's an explicit release tag, retag this image to use it.
  docker tag "$DOCKER_REPO:$TAG" "$DOCKER_REPO:$TRAVIS_TAG"
  docker push "$DOCKER_REPO:$TRAVIS_TAG"
fi
