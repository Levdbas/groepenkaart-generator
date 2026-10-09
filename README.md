# Groepenkaart generator

Een kleine webapp om een groepenkaart (groepenindeling) voor je meterkast of verdeelkast te maken en als PDF te downloaden of af te drukken. De app draait volledig in de browser. Er is geen server, account of build-stap nodig, dus hij werkt direct op GitHub Pages.

**[➜ Open de Groepenkaart generator](https://levdbas.github.io/groepenkaart-generator/)**

## Functies

- Meerdere **kasten** toevoegen, elk met een nummer en een naam
- Per kast **groepen** toevoegen met een nummer, naam en omschrijving
- Kasten en groepen verplaatsen (↑ ↓) en verwijderen (✕)
- **PDF downloaden**: één A4-pagina per kast, in de stijl van een standaard groepenkaart. Lege regels worden aangevuld tot 15 rijen, zodat je later nog met de hand kunt aanvullen.
- **Afdrukken** via de printfunctie van de browser, met dezelfde opmaak
- Automatisch **opslaan in de browser** (localStorage)
- **Exporteren en importeren** als JSON-bestand, voor een back-up of om op een andere computer verder te werken

## Gebruik

1. Open de app (zie [Online zetten](#online-zetten-met-github-pages) of [Lokaal draaien](#lokaal-draaien)).
2. Klik op **+ Kast toevoegen** en vul een kastnummer en een naam in, bijvoorbeeld `1` en `Meterkast begane grond`.
3. Klik in de kast op **+ Groep toevoegen**. Het groepnummer wordt automatisch opgehoogd en kan worden aangepast, bijvoorbeeld naar `1a` of `F3`.
4. Vul per groep de naam (bijvoorbeeld `Keuken`) en de omschrijving (bijvoorbeeld `Wandcontactdozen aanrecht, vaatwasser`) in.
5. Klik op **PDF downloaden** voor een PDF-bestand, of op **Afdrukken** om direct te printen of via het printvenster als PDF op te slaan.

### Gegevens bewaren

Alles wat je invoert wordt automatisch opgeslagen in je browser. Wis je de browsergegevens of gebruik je een andere browser of computer, dan ben je de gegevens kwijt. Gebruik daarom **Exporteren** om een `groepenkaart.json` te bewaren. Met **Importeren** laad je dat bestand later weer in.

Voorbeeld van een exportbestand:

```json
{
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

## Lokaal draaien

Open `index.html` direct in de browser, of start een simpele webserver in de projectmap:

```bash
python3 -m http.server 8000
```

Ga daarna naar <http://localhost:8000>.

## Online zetten met GitHub Pages

De workflow in [.github/workflows/pages.yml](.github/workflows/pages.yml) publiceert de site automatisch bij elke push naar `main`.

Eenmalig instellen:

1. Push de repository naar GitHub.
2. Ga naar **Settings → Pages**.
3. Kies bij **Source** voor **GitHub Actions**.
4. Push naar `main`, of start de workflow handmatig via **Actions → Deploy naar GitHub Pages → Run workflow**.

Na afloop staat de URL van de site in de samenvatting van de workflow, meestal `https://<gebruiker>.github.io/<repository>/`.

## Projectstructuur

```
.
├── index.html                    # Pagina en werkbalk
├── css/style.css                 # Opmaak voor scherm en print
├── js/app.js                     # Gegevens, invoer, opslag, import/export
├── js/pdf.js                     # PDF genereren met jsPDF
├── vendor/                       # jsPDF 2.5.2 en jsPDF-AutoTable 3.8.4 (MIT)
├── .github/workflows/pages.yml   # Deploy naar GitHub Pages
└── .nojekyll                     # Bestanden ongewijzigd serveren op Pages
```

De PDF-bibliotheken staan lokaal in `vendor/`, zodat de app niet afhankelijk is van een externe CDN. Lukt het laden toch niet, dan opent **PDF downloaden** automatisch het printvenster.

## Bibliotheken

- [jsPDF](https://github.com/parallax/jsPDF) (MIT)
- [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) (MIT)
