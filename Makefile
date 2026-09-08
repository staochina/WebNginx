.PHONY: build buildc test

# Pack / test the Chrome extension under src/.
# Native host install lives in webnginx-native/Makefile.

TARGET_DIR = ./target
CHROME_DST = webnginx-chrome.zip

build: buildc test

buildc:
	rm -f $(TARGET_DIR)/$(CHROME_DST) && mkdir -p $(TARGET_DIR)
	cd src && zip -r ../$(TARGET_DIR)/$(CHROME_DST) .

test:
	node --test test/*.mjs
