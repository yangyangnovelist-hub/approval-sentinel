# Proposed addition to the CLI install docs (macOS quarantine note)

Target: the existing `kh` installation section (exact file to be located when forking — wherever `brew install keeperhub/tap/kh` is documented). Splice the following block immediately after the install command.

---

> **macOS:** until the release binaries are signed and notarized, Gatekeeper will kill the freshly installed binary **silently** — `kh version` exits with code 137 and no output, which looks identical to a broken install. Clear the quarantine attribute once:
>
> ```bash
> xattr -d com.apple.quarantine "$(realpath "$(which kh)")"
> ```
>
> Then re-run `kh version`.

---

Also recommended (not part of the docs PR, but cheap): add the same one-liner to the Homebrew formula's `caveats` block so it prints at install time, which is the moment the user needs it.
