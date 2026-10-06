# odds-scanner

Avrupa liglerinin maç oranlarını 30 dakikada bir API-Football'dan okuyup
SurpriseBet uygulamasına (açılış oranı + oran hareketi) yazan zamanlanmış iş.

- Lig listesi ve bahisçi sırası uygulamadan gelir (`/api/odds-track/config`).
- Açılış/seri mantığı uygulamadadır; burada yalnızca yanıt inceltilir.
- Gizli değerler Actions secret'larında: `API_FOOTBALL_KEY`, `ODDS_INGEST_KEY`.
