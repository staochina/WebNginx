.PHONY: build buildc test install-host trust-ca

CHROME_DST = ../target/webnginx-chrome.zip

build: buildc test

buildc:
	rm -f $(CHROME_DST)
	cd src && zip -r $(CHROME_DST) *

test:
	node --test test/*.mjs

# EXT_ID is required, e.g. make install-host EXT_ID=abcdefghijklmnopqrstuvwxyz
install-host:
	@test -n "$(EXT_ID)" || (echo "Set EXT_ID=<chrome-extension-id>" >&2; exit 1)
	EXT_ID="$(EXT_ID)" ./webnginx-native/install-macos.sh

trust-ca:
	./webnginx-native/trust-ca-macos.sh
