.PHONY: install-host trust-ca install-host-sh install-host-bash trust-ca-sh trust-ca-bash

# Standalone install (this directory only).
# macOS:  make install-host EXT_ID=abcdefghijklmnopqrstuvwxyz
# Windows (Git Bash): same; pick shell with SHELL_KIND=sh|bash (default bash)
#
# Examples:
#   make install-host EXT_ID=...
#   make install-host EXT_ID=... SHELL_KIND=sh
#   make trust-ca

SHELL_KIND ?= bash

ifeq ($(OS),Windows_NT)
  INSTALL_SCRIPT = ./install-windows.$(SHELL_KIND)
  TRUST_SCRIPT = ./trust-ca-windows.$(SHELL_KIND)
else
  INSTALL_SCRIPT = ./install-macos.sh
  TRUST_SCRIPT = ./trust-ca-macos.sh
endif

install-host:
	@test -n "$(EXT_ID)" || (echo "Set EXT_ID=<chrome-extension-id>" >&2; exit 1)
	@test -x "$(INSTALL_SCRIPT)" -o -f "$(INSTALL_SCRIPT)" || (echo "Missing $(INSTALL_SCRIPT). On Windows use SHELL_KIND=sh or bash." >&2; exit 1)
	EXT_ID="$(EXT_ID)" "$(INSTALL_SCRIPT)"

trust-ca:
	"$(TRUST_SCRIPT)"

# Explicit Windows shell flavors (no-ops / wrong on macOS if you call them by mistake).
install-host-sh:
	@test -n "$(EXT_ID)" || (echo "Set EXT_ID=<chrome-extension-id>" >&2; exit 1)
	EXT_ID="$(EXT_ID)" ./install-windows.sh

install-host-bash:
	@test -n "$(EXT_ID)" || (echo "Set EXT_ID=<chrome-extension-id>" >&2; exit 1)
	EXT_ID="$(EXT_ID)" ./install-windows.bash

trust-ca-sh:
	./trust-ca-windows.sh

trust-ca-bash:
	./trust-ca-windows.bash
