# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities responsibly and **do not** open a public
issue, discussion, pull request, or Telegram message. Contact the maintainer
privately through the [GitHub profile](https://github.com/stanleymarch). Include
a concise description, affected commit or version, reproduction steps, impact,
and any suggested mitigation. Do not include credentials, access tokens, private
keys, full `.env` files, or other secrets in the report.

Please give the maintainer a reasonable opportunity to investigate and fix the
issue before public disclosure. Do not access data that is not yours, disrupt the
service, or continue testing beyond what is necessary to demonstrate the issue.

## If a secret is exposed

If you find a committed or otherwise exposed Nearventure secret, do not copy it
into an issue, chat, screenshot, commit, or pull request. Notify the maintainer
privately with only the location and secret type. The owner must revoke or rotate
the credential at its provider; deleting a value from Git history alone is not a
sufficient response.

## Scope and support

This is a small maintained project without a response-time guarantee. Reports
about the current development line are welcome. General usage and contribution
questions belong in [SUPPORT.md](SUPPORT.md) or
[CONTRIBUTING.md](CONTRIBUTING.md), not in a vulnerability report.
