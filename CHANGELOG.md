# Changelog

## [1.1.0](https://github.com/Levdbas/groepenkaart-generator/compare/1.0.0...1.1.0) (2026-10-17)


### ⛰️ Features

* add banner image to README for enhanced visibility ([72562cc](https://github.com/Levdbas/groepenkaart-generator/commit/72562ccaacc3856b7e10b10a123133dff06fa514))
* add functionality to display unused RCBOs in print output and PDF ([2f7d361](https://github.com/Levdbas/groepenkaart-generator/commit/2f7d3610a75f7d6e23f40eea9b9ac0c9c12aee3e))
* add installation warnings feature with UI and PDF support ([1eddf3f](https://github.com/Levdbas/groepenkaart-generator/commit/1eddf3f47031bcfd3950f4b0cf4aaa75a94a3d19))
* add optional group items functionality with textarea input and PDF rendering ([3342e5f](https://github.com/Levdbas/groepenkaart-generator/commit/3342e5f02b74c3d98ad9e7b9b50544935d37cc55))
* add QR code functionality to PDF generation ([e3f3fe4](https://github.com/Levdbas/groepenkaart-generator/commit/e3f3fe43aa2c6dd134973fefd3312932f0ccb810))
* add RCBO/Color coding option ([8b74e44](https://github.com/Levdbas/groepenkaart-generator/commit/8b74e447f4d624c018dbc6058d77c46010e90e33))
* add RCBO/Color coding option ([828bff6](https://github.com/Levdbas/groepenkaart-generator/commit/828bff61c4edd46d3368f187058ea2b47b8d3652))
* add RCBO/Color coding option ([d7d4fa4](https://github.com/Levdbas/groepenkaart-generator/commit/d7d4fa41fe207f6a15a38b329231d218cf879fe1))
* add schema type ([5f4809e](https://github.com/Levdbas/groepenkaart-generator/commit/5f4809e856473350cd90e8128b14643ca1e41e23))
* add small build process so we build the dependencies from the sources. ([78383a3](https://github.com/Levdbas/groepenkaart-generator/commit/78383a3b8681598db9a5480bb45d39180f9a0826))
* **ci:** add release automation configuration and changelog support ([1258742](https://github.com/Levdbas/groepenkaart-generator/commit/1258742aa700f21a2e5132129ba458daa9c1e3d5))
* compactere PDF-layout ([#10](https://github.com/Levdbas/groepenkaart-generator/issues/10)) ([5582532](https://github.com/Levdbas/groepenkaart-generator/commit/55825328c99c7fb610482049621721064d0334d6))
* implement compact QR code link format and improve data handling ([9118bdb](https://github.com/Levdbas/groepenkaart-generator/commit/9118bdb5c193a8d8a082b4d0079a85d33bacc9a6))
* improve print options ([3a4ebb4](https://github.com/Levdbas/groepenkaart-generator/commit/3a4ebb4d9d6f0a5cc264b1aa53d3a97c345ceed7))
* initialize first group for new boxes with default values ([095ff41](https://github.com/Levdbas/groepenkaart-generator/commit/095ff41e514df094869bebb5cf4b1a4f4c107da4))
* kleinere koppen en tabelkop in de PDF ([fcd98dd](https://github.com/Levdbas/groepenkaart-generator/commit/fcd98dd9805d5bd0a24619ac7e1aff10b0f813c2))
* move  'Kast toevoegen' button to the bottom of the page to be in line with the groep toevoegen button ([9b3c3c4](https://github.com/Levdbas/groepenkaart-generator/commit/9b3c3c4b8307b422cf968eb0426ff1aa53ed3023))
* new warning icons ([#18](https://github.com/Levdbas/groepenkaart-generator/issues/18)) ([37c4fd9](https://github.com/Levdbas/groepenkaart-generator/commit/37c4fd9be6d2022a1245ff79b0eb3bd2f7d62030))
* rename RCBO references to Aardlekschakelaars across documentation and code ([11869ae](https://github.com/Levdbas/groepenkaart-generator/commit/11869ae2da40047f1200b8c202c60e6f21f64b3c))
* rename the wording for the warnings for Airco/heatpump, remove the EV charger warning. ([3a743ef](https://github.com/Levdbas/groepenkaart-generator/commit/3a743ef52b87606902b56c4e7166aac313407d10))
* schema v3 ([3517a14](https://github.com/Levdbas/groepenkaart-generator/commit/3517a14c29ef6bc669342ba16f7a534e54e0b12f))
* some mobile optimizations ([ae17530](https://github.com/Levdbas/groepenkaart-generator/commit/ae17530540cab233b7ef3b3349b8a995db6c5444))
* update issue templates for bug reports and feature requests ([3957aef](https://github.com/Levdbas/groepenkaart-generator/commit/3957aeffc35807c4babb44aab3130932633cf63d))
* update JSON schema handling and export format ([a9a8f38](https://github.com/Levdbas/groepenkaart-generator/commit/a9a8f386b1f9435d79c94956b586ed1f59055e44))
* update tests to verify unused Aardlekschakelaars are listed separately in PDF output ([208486f](https://github.com/Levdbas/groepenkaart-generator/commit/208486fea429f801ade88a29522bfd4f5c179bc0))
* update warning display position in PDF and UI to show below print date ([76b1abd](https://github.com/Levdbas/groepenkaart-generator/commit/76b1abdbde7b10966b0eabf41e8d04af83972e46))


### 🐛 Bug Fixes

* add bottom margin to .boxes to prevent browser chrome to hide the add group button ([4935d4d](https://github.com/Levdbas/groepenkaart-generator/commit/4935d4d7361b55a1d9a02cf4c08f87e9a7775e4f))
* change release type from html to node and clean up extra files configuration ([3c49a4c](https://github.com/Levdbas/groepenkaart-generator/commit/3c49a4cf1734592e9a39dc29b7bcc2a57fb754dd))
* rename rcbo to rcd ([5cd3f00](https://github.com/Levdbas/groepenkaart-generator/commit/5cd3f0075c59337c5bd3290d7a0e877ac15bc588))
* revert version to 1.0.0 and remove bootstrap SHA from config ([e886e7f](https://github.com/Levdbas/groepenkaart-generator/commit/e886e7ff7602fcbe7480b4d1b49300a9b6e973e7))
* update select styles for improved readability ([b12e195](https://github.com/Levdbas/groepenkaart-generator/commit/b12e195c3f3a302a0ba70f1bc1d6a8626e0516a1))


### 📚 Documentation

* remove unnecessary server/account mention from app description ([c970af4](https://github.com/Levdbas/groepenkaart-generator/commit/c970af4090e262568d6243b111a270dc7cf6b378))
* update local development instructions for clarity and completeness ([e27d741](https://github.com/Levdbas/groepenkaart-generator/commit/e27d74156ff12290ae5bd5675f33843b45a9485c))


### ⚙️ Miscellaneous Tasks

* easier reporting templates ([0c8daf8](https://github.com/Levdbas/groepenkaart-generator/commit/0c8daf8cf63f4d66c794c1a6491f6649eb9c8d4c))
* no more automatic deployment for main ([12569de](https://github.com/Levdbas/groepenkaart-generator/commit/12569deae715e00342a69a55b64af2a6c50b0a26))
* update favicon, og:image and banner ([c43ca31](https://github.com/Levdbas/groepenkaart-generator/commit/c43ca31365017ece973fc40fe36c88b1b910b16a))
