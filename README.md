[![Groepenkaart generator: maak gratis je eigen groepenkaart voor de meterkast en download als PDF](.github/banner.png)](https://levdbas.github.io/groepenkaart-generator/)

# Groepenkaart generator

Een kleine webapp om een groepenkaart (groepenindeling) voor je meterkast of verdeelkast te maken en als PDF te downloaden of af te drukken. De app draait volledig in de browser.

**[➜ Open de Groepenkaart generator](https://levdbas.github.io/groepenkaart-generator/)**

## Functies

- Meerdere **kasten** toevoegen, elk met een nummer en een naam
- Per kast **groepen** toevoegen met een nummer, naam en omschrijving
- Kasten en groepen verplaatsen (↑ ↓) en verwijderen (✕)
- **Installatiewaarschuwingen** aanvinken voor zonnepanelen (PV-installatie), een EV-lader, thuisbatterij en airco/warmtepomp. De geselecteerde waarschuwingen verschijnen als grote rode kaarten met pictogrammen op de eerste pagina, zowel in de PDF als bij afdrukken.
- **Aardlekautomaten** (aardlekautomaat: Residual Current Breaker with Overcurrent protection, RCBO): zet **Groepen koppelen aan Aardlekautomaten** aan, voeg aardlekautomaten toe met een eigen code, naam en kleur, en koppel groepen eraan. In de PDF en bij afdrukken krijgt het groepnummer de kleur en code van de gekoppelde aardlekautomaat, met een legenda per pagina.
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
6. Gebruik je aardlekautomaten? Vink dan **Groepen koppelen aan Aardlekautomaten** aan en klik op **+ Aardlekautomaat toevoegen**. Geef elke aardlekautomaat een code (bijvoorbeeld `A1`), een naam en een kleur. Standaard krijgt `A1` oranje (`#ed8c01`), `A2` blauw (`#009fe3`), `A3` groen (`#95be1a`) en elke volgende aardlekautomaat grijs (`#9e9e9e`); je kunt de kleur altijd aanpassen. Kies daarna per groep in de kolom **Aardlekautomaat** bij welke aardlekautomaat de groep hoort. De aardlekautomaten gelden voor de hele installatie en zijn niet aan een kast gebonden. Als je een aardlekautomaat verwijdert, worden de gekoppelde groepen ontkoppeld. Zet je de optie uit, dan worden na bevestiging alle aardlekautomaten en koppelingen verwijderd.
7. Klik op **PDF downloaden** voor een PDF-bestand, of op **Afdrukken** om direct te printen of via het printvenster als PDF op te slaan.

### Gegevens bewaren

Alles wat je invoert wordt automatisch opgeslagen in je browser. Wis je de browsergegevens of gebruik je een andere browser of computer, dan ben je de gegevens kwijt. Gebruik daarom **Exporteren** om een `groepenkaart.json` te bewaren. Met **Importeren** laad je dat bestand later weer in.

Ook de installatiewaarschuwingen worden opgeslagen en geëxporteerd. De mogelijke codes in `warnings` zijn `pv`, `ev`, `battery` en `heat-pump`. Oude bestanden zonder `warnings` blijven werken en worden zonder aangevinkte waarschuwingen geladen. Aardlekautomaten staan in `rcbos` (met `id`, `number`, `name` en een kleur als `#rrggbb`); `rcboEnabled` geeft aan of de koppeling aanstaat. Een groep verwijst met `rcboId` naar het `id` van een aardlekautomaat, of heeft `null` als de groep niet gekoppeld is. **Alles wissen** verwijdert kasten, groepen, de geselecteerde waarschuwingen en de aardlekautomaten.

Voorbeeld van een exportbestand:

```json
{
  "$schema": "https://raw.githubusercontent.com/Levdbas/groepenkaart-generator/main/schemas/groepenkaart-v2.schema.json",
  "schemaVersion": 2,
  "warnings": ["pv", "ev", "battery", "heat-pump"],
  "rcboEnabled": true,
  "rcbos": [
    {
      "id": "5eefe74d-12b8-40e6-825b-409e26c0b066",
      "number": "A1",
      "name": "Keuken en badkamer",
      "color": "#ed8c01"
    }
  ],
  "boxes": [
    {
      "number": "1",
      "name": "Meterkast begane grond",
      "groups": [
        {
          "number": "1",
          "name": "Keuken",
          "description": "Wandcontactdozen aanrecht",
          "rcboId": "5eefe74d-12b8-40e6-825b-409e26c0b066"
        },
        {
          "number": "2",
          "name": "Woonkamer",
          "description": "Verlichting en wandcontactdozen",
          "rcboId": null
        }
      ]
    }
  ]
}
```

### Schemaversies en migraties

JSON-exportbestanden en browseropslag bevatten `schemaVersion: 2`. Dit is de versie van het gegevensformaat, onafhankelijk van de appversie. De gedeelde gegevenstypen (`CardData`, `BoxData`, `GroupData`, `RcboData` en `WarningCode`), validatie en migraties staan in [src/js/schema.js](src/js/schema.js).

Het [JSON Schema voor versie 2](schemas/groepenkaart-v2.schema.json) is beschikbaar via [raw.githubusercontent.com](https://raw.githubusercontent.com/Levdbas/groepenkaart-generator/main/schemas/groepenkaart-v2.schema.json), zodat andere tools exportbestanden kunnen valideren. Het [schema voor versie 1](schemas/groepenkaart-v1.schema.json) blijft ongewijzigd gepubliceerd. Elke export bevat `$schema` met de URL van de huidige versie; browseropslag bevat dit metadataveld niet. Het veld is optioneel voor import en externe validatie. De app gebruikt `schemaVersion` voor validatie en migraties en haalt geen schema op tijdens import. Versie 2 vereist `schemaVersion`, `warnings`, `rcboEnabled`, `rcbos` en `boxes`, en per groep `rcboId`. Een `rcboId` moet naar een bestaande aardlekautomaat verwijzen, en `rcbos` moet leeg zijn als `rcboEnabled` uit staat. De persistente `id` van een aardlekautomaat wordt wel opgeslagen; interne UI-ID's van kasten en groepen niet.

Bestanden zonder `schemaVersion` (of met versie `0`) zijn het oude formaat en worden automatisch gemigreerd. Ontbrekende waarschuwingen worden een lege lijst; de bestaande omzetting van numerieke velden naar tekst blijft behouden. Bij de migratie van versie 1 naar 2 staat de koppeling met aardlekautomaten uit, zonder aardlekautomaten, en krijgt elke groep `rcboId: null`. Browseropslag blijft dezelfde sleutel `groepenkaart:v1` gebruiken om bestaande gegevens terug te vinden en wordt na succesvol laden in het huidige formaat opgeslagen.

Een onbekende nieuwere versie wordt geweigerd met een melding. Bij een mislukte import blijven de huidige gegevens intact. Als browseropslag niet kan worden geladen, blijft die bewaard en schrijven bewerkingen er niet overheen totdat je bewust een geldig bestand importeert of **Alles wissen** bevestigt.

Bij een toekomstige formaatwijziging: verhoog `currentVersion`, werk de gegevenstypen en validatie bij, voeg een migratiestap van versie N naar N+1 toe en publiceer een nieuw schema zonder het oude te wijzigen. Voeg regressietests toe voor de volledige migratieketen. Een nieuwe functie die het gegevensformaat niet verandert, hoeft geen nieuwe schemaversie te krijgen.

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
│   ├── js/rcbo.js                # Gedeelde hulpfuncties voor aardlekautomaten (kleuren, labels)
│   ├── js/schema.js              # Gegevenstypen, schemaversies, validatie en migraties
│   ├── js/app.js                 # Gegevens, invoer, opslag, import/export
│   └── js/pdf.js                 # PDF genereren met jsPDF
├── public/                       # Wordt ongewijzigd naar dist/ gekopieerd
├── schemas/                      # JSON Schemas per gegevensversie (via raw GitHub)
├── scripts/build.mjs             # Build en dev-server
├── .github/workflows/pages.yml   # Bouwen en deployen naar GitHub Pages
└── package.json
```

## Tests

Voer `npm test` uit voor regressietests van schemaversies, migraties, browseropslag, import/export, waarschuwingselectie, aardlekautomaten en de echte PDF-uitvoer, inclusief oudere gegevens, alle vier kaarten en meerdere pagina's. De tests gebruiken de ingebouwde Node.js-testrunner.

## Bibliotheken

- [jsPDF](https://github.com/parallax/jsPDF) (MIT)
- [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) (MIT)
