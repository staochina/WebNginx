.PHONY: install-host trust-ca

# Standalone install (this directory only). Example:
#   make install-host EXT_ID=abcdefghijklmnopqrstuvwxyz
install-host:
	@test -n "$(EXT_ID)" || (echo "Set EXT_ID=<chrome-extension-id>" >&2; exit 1)
	EXT_ID="$(EXT_ID)" ./install-macos.sh

trust-ca:
	./trust-ca-macos.sh
