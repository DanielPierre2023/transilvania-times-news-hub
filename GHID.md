# Cum se montează un episod — pas cu pas

Cinci pași, în ordine. Bara de sus arată unde ești; un pas blocat spune de ce.

---

## 1 · Piste

Încarci fișierele: fiecare cameră și fiecare microfon, separat.

Pune un **nume de vorbitor** pe fiecare microfon (Ana, Bogdan…). Nu e cosmetic:
din el vine atribuirea replicilor și tăierea între camere. Fără nume, tot
restul funcționează, dar episodul are o singură cameră și un singur vorbitor.

Apeși **Aliniază pistele**. Cele patru fișiere au pornit când a apăsat fiecare
om, deci nu sunt de acord ce oră e. Alinierea o măsoară din formele de undă și
îți arată cu ce încredere: dacă scrie *nesigur*, verifică manual înainte de a
merge mai departe — o sincronizare greșită arată exact ca una bună până te uiți
la film.

## 2 · Transcriere

Un buton. Se taie în bucăți în browser (serviciul refuză fișiere peste 25 MB,
iar o oră e mult peste) și marcajele fiecărei bucăți se mută înapoi în întreg,
deci minutul 47 rămâne minutul 47.

Dacă ai două lavaliere, aici se atribuie și replicile: vorbește cel al cărui
**propriu** microfon e tare; ceilalți îl aud din cameră, mai încet. Îți arată
raportul de separare. Sub 1,5× înseamnă probabil două microfoane omni pe aceeași
masă, iar atribuirea e nesigură — scrie asta, nu o ascunde.

## 3 · Montaj — **aici se face episodul**

Ai transcrierea pe ecran. Nu e un raport, e montajul.

| Ce vrei | Ce faci |
|---|---|
| Să auzi un pasaj | click pe un cuvânt |
| **Să tai** | ține apăsat și trage peste cuvinte → **Taie** (sau tasta Delete) |
| Să pui înapoi | click pe un cuvânt barat |
| Să anulezi | Ctrl+Z (Ctrl+Shift+Z pentru refacere) |
| Play/pauză | bara de spațiu |

**Culorile:** alb = rămâne. Barat galben = umplutură scoasă automat. Barat
albastru = tăcere scurtată automat. Barat roșu = ai tăiat tu. Orice cuvânt barat
se pune înapoi cu un click — inclusiv cele scoase automat, individual, nu tot
pasul sau nimic.

**Cele două comutatoare** de sus scot umpluturile („ăăă", „deci" când stă
singur între pauze) și scurtează tăcerile. Cursorul spune de la ce lungime în
sus o pauză se scurtează. Ce rămâne din pauză nu e zero niciodată: două fraze
lipite fără respirație e cel mai sigur semn că un episod a fost montat automat.

**„Redă montajul"** sare peste tăieturi în timp ce ascultă. Așa auzi montajul
înainte să plătești o randare.

Sus, permanent: cât era → cât e, câte secunde au ieșit, din ce fel de tăieturi.

## 4 · Sunet

**Volumul** — implicit −16 LUFS, care e ținta la care normalizează platformele.
Nu e o preferință: un episod livrat la −23 sună mai încet decât tot ce e în
jurul lui în aplicație. Se măsoară mixul, apoi se aplică corecția cu valorile
măsurate.

**Procesarea vocii** — un filtru trece-sus scoate huruitul mesei și al aerului
condiționat. Nu se aude la boxe mici; e foarte prezent în căști.

**Echilibrul între vorbitori** — cu un lavalier pe fiecare, unul e mereu cu
trei-patru dB mai tare. E cel mai audibil defect al formatului. Cursor per
vorbitor.

**Patul muzical** — dacă pui muzică, se dă la o parte de sub voce printr-un
sidechain real: scade când se vorbește, revine în pauze. Fără muzică e o alegere
validă pentru un interviu.

## 5 · Livrare

Din **același montaj**, deci nu pot fi în dezacord:

- **MP3** pentru feed — normalizat, cu titlu în etichete
- **Video** 1080p sau 4K pentru YouTube
- **.srt** și **.vtt** — subtitrări din transcrierea montată
- **Capitole** în două formate: text pentru descriere, JSON pentru Podcasting 2.0
- **Titlu, subtitlu, descriere, cuvinte cheie, citate** — scrise din transcrierea
  **montată**, ca să nu citeze o frază pe care ai tăiat-o
- **Transcriere** cu marcaje de timp
- **Clipuri verticale** pentru social, randate direct

---

## „Pregătește tot automat"

Butonul din dreapta sus rulează pașii care nu cer judecată: aliniere →
transcriere → materiale de publicare. Apoi **se oprește la montaj**.

Deliberat. O listă de tăieturi făcută automat e o primă schiță bună și un
răspuns final proast: randarea înainte ca cineva să o citească înseamnă bani pe
un fișier care se aruncă.

---

## Ce nu face încă

Ca să știi înainte, nu după:

- **Intro / outro** ca piese separate. Muzica e pat continuu sub tot episodul,
  nu un jingle la cap și la coadă. Se poate adăuga, dar nu e aici.
- **Reducere de zgomot**. Filtrul trece-sus scoate huruitul; un fundal de
  ventilație constant nu se scoate încă.
- **Editarea capitolelor în pagină**. Titlurile lor sunt prima frază a
  pasajului; le redenumești în fișierul exportat.
- **Corectarea transcrierii**. Poți tăia cuvinte, nu le poți rescrie. Un nume
  propriu greșit rămâne greșit în subtitrări.
