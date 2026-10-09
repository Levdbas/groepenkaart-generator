[![Groepenkaart generator: maak gratis je eigen groepenkaart voor de meterkast en download als PDF](.github/banner.png)](https://levdbas.github.io/groepenkaart-generator/)

# Groepenkaart generator

Een kleine webapp om een groepenkaart (groepenindeling) voor je meterkast of verdeelkast te maken en als PDF te downloaden of af te drukken. De app draait volledig in de browser.

**[➜ Open de Groepenkaart generator](https://levdbas.github.io/groepenkaart-generator/)**

## Functies

- Meerdere **kasten** toevoegen, elk met een nummer en een naam
- Per kast **groepen** toevoegen met een nummer, naam en omschrijving
- Kasten en groepen verplaatsen (↑ ↓) en verwijderen (✕)
- **Installatiewaarschuwingen** aanvinken voor zonnepanelen (PV-installatie), een EV-lader, thuisbatterij en airco/warmtepomp. De geselecteerde waarschuwingen verschijnen als grote rode kaarten met pictogrammen onder de titel **Groepenindeling** op alleen de eerste pagina, zowel in de PDF als bij afdrukken.
- **PDF downloaden**: één A4-pagina per kast, in de stijl van een standaard groepenkaart. Lege regels worden aangevuld tot 15 rijen, zodat je later nog met de hand kunt aanvullen.
- **Afdrukken** via de printfunctie van de browser, met dezelfde opmaak
- Automatisch **opslaan in de browser** (localStorage)
- **Exporteren en importeren** als JSON-bestand, voor een back-up of om op een andere computer verder te werken

## Gebruik

1. Open de [web app](https://levdbas.github.io/groepenkaart-generator/) of [draai de app lokaal](#lokaal-draaien).
2. Klik onderaan de pagina op **+ Kast toevoegen** en vul een kastnummer en een naam in, bijvoorbeeld `1` en `Meterkast begane grond`.
3. Elke nieuwe kast begint automatisch met groep `1`. Klik op **+ Groep toevoegen** voor extra groepen. Het groepnummer wordt automatisch opgehoogd en kan worden aangepast, bijvoorbeeld naar `1a` of `F3`.
4. Vul per groep de naam (bijvoorbeeld `Keuken`) en de omschrijving (bijvoorbeeld `Wandcontactdozen aanrecht, vaatwasser`) in.
5. Vink bij **Aanwezige installaties** aan welke installaties aanwezig zijn. De selectie geldt voor de hele installatie, niet per kast. Standaard is niets aangevinkt. Elke kaart vermeldt **LET OP!**, de aanwezige installatie en **Gevaarlijke DC-spanning op de bekabeling mogelijk!** Controleer of deze waarschuwing van toepassing is op jouw installatie.
6. Klik op **PDF downloaden** voor een PDF-bestand, of op **Afdrukken** om direct te printen of via het printvenster als PDF op te slaan.

### Gegevens bewaren

Alles wat je invoert wordt automatisch opgeslagen in je browser. Wis je de browsergegevens of gebruik je een andere browser of computer, dan ben je de gegevens kwijt. Gebruik daarom **Exporteren** om een `groepenkaart.json` te bewaren. Met **Importeren** laad je dat bestand later weer in.

Ook de installatiewaarschuwingen worden opgeslagen en geëxporteerd. De mogelijke codes in `warnings` zijn `pv`, `ev`, `battery` en `heat-pump`. Oude bestanden zonder `warnings` blijven werken en worden zonder aangevinkte waarschuwingen geladen. **Alles wissen** verwijdert zowel kasten en groepen als de geselecteerde waarschuwingen.

Voorbeeld van een exportbestand:

```json
{
  "warnings": ["pv", "ev", "battery", "heat-pump"],
  "boxes": [
    {
      "number": "1",
      "name": "Meterkast begane grond",
      "groups": [
        {
          "number": "1",
          "name": "Keuken",
          "description": "Wandcontactdozen aanrecht"
        },
        {
          "number": "2",
          "name": "Woonkamer",
          "description": "Verlichting en wandcontactdozen"
        }
      ]
    }
  ]
}
```

## Lokaal draaien / development

Je hebt [Node.js](https://nodejs.org/) 20.11 of nieuwer nodig. De app moet eerst gebouwd worden: `src/index.html` direct in de browser openen werkt niet, omdat de CSS- en JS-bestanden pas tijdens de build worden ingevuld.

1. Haal de code op en installeer de dependencies:

   ```bash
   git clone https://github.com/Levdbas/groepenkaart-generator.git
   cd groepenkaart-generator
   npm install
   ```

2. Start de ontwikkelserver:

   ```bash
   npm run dev
   ```

   Dit bouwt de app naar `dist/` en start een webserver op <http://localhost:8000>. Bij elke wijziging in `src/` of `public/` wordt de app automatisch opnieuw gebouwd. Ververs daarna de pagina om het resultaat te zien. Een andere poort kies je met `PORT=3000 npm run dev`.

3. Wil je alleen de bestanden bouwen, zonder server? Gebruik dan `npm run build` (zie [Bouwen](#bouwen)).

## Bouwen

```bash
npm run build
```

Dit maakt de map `dist/` met daarin:

- `vendor.<hash>.js`: jsPDF en jsPDF-AutoTable uit `node_modules`, samengevoegd
- `app.<hash>.js`: de eigen scripts uit `src/js/`, geminificeerd
- `app.<hash>.css`: de opmaak uit `src/css/`, geminificeerd
- `index.html` met de juiste bestandsnamen ingevuld
- alles uit `public/` (favicons, deelafbeelding, `.nojekyll`)

De hash in de bestandsnaam is gebaseerd op de inhoud. Verandert een bestand, dan krijgt het een nieuwe naam en laadt de browser altijd de nieuwste versie. In `src/index.html` staan daarvoor placeholders (`{{app.css}}`, `{{vendor.js}}`, `{{app.js}}`) die de build vervangt.

Bij elke push naar `main` draait de GitHub Action in [.github/workflows/pages.yml](.github/workflows/pages.yml) `npm ci` en `npm run build` en publiceert `dist/` op GitHub Pages.

## Projectstructuur

```
.
├── src/
│   ├── index.html                # Pagina en werkbalk (met placeholders)
│   ├── css/style.css             # Opmaak voor scherm en print
│   ├── js/warnings.js             # Gedeelde installatiewaarschuwingen en pictogrammen
│   ├── js/app.js                 # Gegevens, invoer, opslag, import/export
│   └── js/pdf.js                 # PDF genereren met jsPDF
├── public/                       # Wordt ongewijzigd naar dist/ gekopieerd
├── scripts/build.mjs             # Build en dev-server
├── .github/workflows/pages.yml   # Bouwen en deployen naar GitHub Pages
└── package.json
```

## Tests

Voer `npm test` uit voor regressietests van de waarschuwingselectie en de echte PDF-uitvoer, inclusief oudere gegevens, alle vier kaarten en meerdere pagina's. De tests gebruiken de ingebouwde Node.js-testrunner.

## Bibliotheken

- [jsPDF](https://github.com/parallax/jsPDF) (MIT)
- [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) (MIT)
