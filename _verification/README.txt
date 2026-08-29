DO NOT COMMIT THIS FOLDER.

timeline-tests.js is the evidence, not code for the repo. The repo's vitest
config only covers src/** (the legacy Vite code) and vitest is not installed,
so a test file added under lib/ would never run and would only risk the build.

64 assertions, all passing. Compiled with the project's own tsconfig and run on
Node 22.
