.PHONY: chrome firefox

all: chrome firefox

chrome: build/ohmytab_chrome.zip

firefox: build/ohmytab_firefox.zip

build/ohmytab_chrome.zip:
	mkdir -p build
	cd src && zip -r ../build/ohmytab_chrome.zip *

build/ohmytab_firefox.zip: build/src_firefox
	cd build/src_firefox && zip -r ../ohmytab_firefox.zip *

build/src_firefox: 
	mkdir -p build
	cp -r src/ build/src_firefox
	patch -u build/src_firefox/manifest.json src_firefox/patch

clean:
	rm -r build
