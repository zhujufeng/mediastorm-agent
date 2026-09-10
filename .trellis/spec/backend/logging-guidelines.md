# Logging

The current check emits one fixed PASS line after successful assertions; failures use Node's error output.

Do not log credentials, environment dumps, personal conversation history, or full collected datasets. No logging library or remote telemetry service is configured.

Future application output should explain the current step and observed result in plain language. Keep detailed command results available for debugging without confusing them with business success.
