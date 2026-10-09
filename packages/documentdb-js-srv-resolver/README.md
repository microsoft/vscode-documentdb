# DocumentDB JS SRV Resolver

In-memory SRV DNS fallback for `mongodb+srv://` connection strings when Node.js's c-ares resolver rejects a valid DNS reply (`querySrv EBADRESP`, see microsoft/vscode-documentdb#993).

It asks only the system DNS servers (`dns.getServers()`) and never persists the resolved string.

This package is not yet published to npm.
