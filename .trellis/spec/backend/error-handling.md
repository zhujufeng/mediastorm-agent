# Error Handling

The current executable example is scripts/check-pi.mjs.

- Failed imports, initialization, or assertions must propagate to a nonzero process exit.
- Inspect loader.getExtensions().errors; extension loading can report errors without throwing.
- Capture bindExtensions onError callbacks and assert that startup succeeded.
- Use finally to dispose the session and remove the temporary agent directory.
- Do not print PASS before all assertions succeed.

For future business tools, preserve actual command status and results. An Agent finishing a response is not evidence that a test or artifact passed.
