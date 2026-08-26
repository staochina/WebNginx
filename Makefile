.PHONY: build buildc test

CHROME_DST = ../target/webnginx-chrome.zip

build: buildc test

buildc:
	rm -f $(CHROME_DST)
	cd src && zip -r $(CHROME_DST) *

test:
	node --test test/*.mjs
