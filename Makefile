.PHONY: all build chrome firefox clean test-build

all: build

build:
	pnpm run build

chrome:
	pnpm run build-chrome

firefox:
	pnpm run build-firefox

clean:
	pnpm run clean

test-build:
	pnpm run test:build
