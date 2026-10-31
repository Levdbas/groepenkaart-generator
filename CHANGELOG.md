# Changelog

## [2.1.0](https://github.com/Levdbas/groepenkaart-generator/compare/2.0.0...2.1.0) (2026-10-29)


### ⛰️ Features

* add option to duplicate a module ([8fde2b1](https://github.com/Levdbas/groepenkaart-generator/commit/8fde2b13395cc19a2c6595d0794abe19ddc7610e)), closes [#49](https://github.com/Levdbas/groepenkaart-generator/issues/49)
* add options to trim empty rows in PDF output for a more compact layout ([#53](https://github.com/Levdbas/groepenkaart-generator/issues/53)) ([2c31a74](https://github.com/Levdbas/groepenkaart-generator/commit/2c31a74642e39d2a337e3133e66a94c65f0c7a46))
* choose the netbeheerder from a list ([943289a](https://github.com/Levdbas/groepenkaart-generator/commit/943289a58f5dafc54885ff9d1a06b95dcdd0ad14)), closes [#46](https://github.com/Levdbas/groepenkaart-generator/issues/46)
* enable PDF compression to reduce file size of rasterized warning icons ([7119e11](https://github.com/Levdbas/groepenkaart-generator/commit/7119e115fe71f6362fde799143d5e51be2d26d00))
* Leg voedingsvolgorde van kWh-meters vast ([#54](https://github.com/Levdbas/groepenkaart-generator/issues/54)) ([9680040](https://github.com/Levdbas/groepenkaart-generator/commit/96800407e1a03ce498f4865a4ada2e9d368e9a6f))
* size modules to the DIN module ratio ([272003b](https://github.com/Levdbas/groepenkaart-generator/commit/272003b9c98e19da355fbc590620bc7673d3f951)), closes [#45](https://github.com/Levdbas/groepenkaart-generator/issues/45)


### 🐛 Bug Fixes

* adjust height calculation for general info section in PDF ([1bd54d7](https://github.com/Levdbas/groepenkaart-generator/commit/1bd54d74c8a57ba745cd0c3ca18a3d34306fc0a6))
* mark Bell-TRANSFORMER as mcbLinkable and update related tests ([2d79d87](https://github.com/Levdbas/groepenkaart-generator/commit/2d79d87203605d9198073d8f5774101b6df6b92d))


### ⚙️ Miscellaneous Tasks

* allow OTHER module types to be linked to aardlekschakelaars as well ([09ec494](https://github.com/Levdbas/groepenkaart-generator/commit/09ec4943ae0f5ed99b5e448a2197a9f6e5b22f93))
* remove release-as version from release-please configuration ([cb57d40](https://github.com/Levdbas/groepenkaart-generator/commit/cb57d40e21beb1906ab3a8a8b4fc6b5483e544aa))
* update bug report template to remove outdated instructions for file submission ([4c4c2f8](https://github.com/Levdbas/groepenkaart-generator/commit/4c4c2f858ba6e680dc96ba633832d886e00ba48a))
* update GitHub Actions to use latest versions of checkout, setup-node, configure-pages, upload-pages-artifact, and deploy-pages ([06391e9](https://github.com/Levdbas/groepenkaart-generator/commit/06391e9fdf123beaf11c7688ccd200eb2f98ee8d))

## [2.0.0](https://github.com/Levdbas/groepenkaart-generator/compare/1.0.0...2.0.0) (2026-10-18)


### ⛰️ Features

* compacte c2-deellinks en QR-code voor schema v5, c1- en #data=-links blijven leesbaar ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* dinrail stopcontact en andere modules koppelen aan een installatieautomaat met overname van fasen en nominale stroom ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* expertmodus voor technische velden zoals gevoeligheid, aardlektype en nominale stroom ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* groepenkaart model 5 and beta features ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* hulppagina om een groepenkaart te anonimiseren voor bugmeldingen ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* meerdere bijzondere installaties (zonnepanelen, EV-lader, thuisbatterij) per module en effectieve waarschuwingen voor modules die een onderverdeler voeden ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* moduletypecatalogus met variabele breedte (RCBO-2P, OTHER) en nieuw type SPD-4P ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* PDF-voorbeeld per pagina met in- en uitzoomen en downloadknop ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* RCD- en RCBO-modules direct in de kast plaatsen, met 2- of 4-polige fasen ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* schema v5 met kasten en modules met stabiele IDs, plus migraties van schema v1 t/m v4 ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* visuele kast met rails en plekken, modules plaatsen, selecteren en verplaatsen (complete rebuild of UX) ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* voeding per kast: hoofdaansluiting, onderverdeler en gekoppelde kast, met aansluitwaarde 1x10A ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))


### 🐛 Bug Fixes

* omschrijving van expertmodus en afhandeling van aardlektypes ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))


### 🚜 Refactor

* afhandeling en opmaak van waarschuwingen in de PDF ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))


### 📚 Documentation

* README, schema en moduletypes bijgewerkt voor schema v5 ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))


### ⚙️ Miscellaneous Tasks

* beta-deployment workflow toegevoegd ([eeb2eba](https://github.com/Levdbas/groepenkaart-generator/commit/eeb2eba41c0ed0a920b259a9ea1a5e6ec17d0bb4))
* update release configuration with bootstrap SHA and release version ([17b6428](https://github.com/Levdbas/groepenkaart-generator/commit/17b642844da539283d2401fd17f304a67dc0e3de))
