# Changelog

All notable changes to the [SeaRM SDK](https://www.npmjs.com/package/searm-sdk) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **`searm-client-sdk` should now be a dev dependency too.** Although app code imports it (`CoreApiClient`, `MetadataApiClient`, `RestApiClient`), SeaRM provides it at runtime — logic functions get it from a generated SDK layer and front components resolve it from server-served modules — so the installed copy is only needed for typechecking and the deploy-time build. Newly scaffolded apps now place it under `devDependencies`. Moving it is recommended (not required: the server already strips it from the deployed runtime), and keeps the installed app leaner:

  ```diff
    "dependencies": {
  -   "searm-client-sdk": "^2.13.0"
    },
    "devDependencies": {
  +   "searm-client-sdk": "^2.13.0"
    }
  ```

  `searm build` now also emits a warning when `searm-client-sdk` is still listed under `dependencies`.

## [2.8.0]

### Breaking Changes

- **`searm-sdk` must now be a dev dependency.** It ships the `searm` CLI and the build/scaffolding tooling, which only run at development and build time — it is never imported by a published app's runtime. Newly scaffolded apps already place it under `devDependencies`. Apps created before `2.8.0` must move it when upgrading:

  ```diff
    "dependencies": {
      "searm-client-sdk": "^2.8.0"
  -   "searm-sdk": "^2.8.0"
    },
    "devDependencies": {
  +   "searm-sdk": "^2.8.0"
    }
  ```

  Then reinstall with `rm -rf node_modules && yarn install`. `searm-client-sdk` stays under `dependencies` because app code imports it at runtime.

  `searm build` now emits a warning when `searm-sdk` is still listed under `dependencies`, so existing apps are flagged automatically.
