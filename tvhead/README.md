# JACK

En interaktiv 3D-figur med TV-hode som følger musen, inspirert av hvordan
[L.I.S.A. fra Locomotive](https://lisa.locomotive.ca/en) er bygget: Three.js,
et enkelt «skjelett» (torso → nakke → hode) og bevegelse som regnes ut i kode
hver frame.

Ingen byggesteg. Alt er vanlige filer som Vercel serverer direkte.

## Filer

| Fil | Hva den gjør |
|---|---|
| `index.html` | Siden, tekst og knapper |
| `src/main.js` | Scene, lys, effekter, musestyring, chat. **`CONFIG` øverst** er det du endrer. |
| `src/character.js` | Figuren (genser, nakke, TV) bygget i kode |
| `src/screen.js` | Ansiktet på skjermen (shader) |
| `src/textures.js` | Strikk, plast og høyttaler-teksturer, generert i kode |
| `src/market.js` | Kursdata fra DexScreener (eller demo) |
| `src/agent.js` | Agent-feeden, humør, chart- og terminalkanalen |
| `src/screen.js` | CRT-skjermen (innhold, etterglød, glassrør) |
| `src/cables.js` | Ledningsfysikken |
| `assets/studio.hdr` | Studiolys for refleksjoner (Poly Haven, CC0) |
| `models/tvhead.glb` | 3D-modellen (laget av `tools/build_model.py`) |
| `tools/build_model.py` | Blender-skriptet som bygger modellen |
| `src/style.css` | Utseende på tekst og knapper |

## Endre ting raskt

Alt du trenger å endre står i `CONFIG` øverst i `src/main.js`:

```js
const CONFIG = {
  name: 'TV/HEAD',             // navnet oppe til venstre og på TV-en
  ticker: '$TVHEAD',           // står på genseren, chatten og kjøpsknappen
  accent: '#ff3a22',           // vanlig farge
  pumpColor: '#39ff88',        // farge når kursen går opp
  dumpColor: '#ff1d1d',        // farge når kursen går ned
  chain: 'solana',
  contractAddress: '',         // lim inn CA etter lansering. Tom = demomodus
  links: { buy: '...', chart: '', x: '...', telegram: '...' },
  modelUrl: null,              // din egen 3D-modell, f.eks. 'models/meg.glb'
};
```

- **Uten CA** kjører siden i *demomodus* med tilfeldig kurs, og det står DEMO i feeden.
- **Med CA** hentes ekte pris, 24t-endring, market cap og volum fra DexScreener hvert 20. sekund.
  Ansiktet blir glad og grønt ved pump, lei seg og rødt ved dump, og TV-en bytter av og til til chart-kanalen.
- Agent-feeden er kommentarer laget ut fra markedsdataene. Den handler ikke, og siden sier det tydelig.
- Teksten i chatten står i `SCRIPT` i `src/main.js`. Agentens replikker står i `src/agent.js`.
- `?lite` på slutten av adressen slår av de tyngste effektene.

## Kjøre lokalt

```bash
npx http-server .
# åpne http://localhost:8080
```

## 3D-modellen (`models/tvhead.glb`)

Jack bygges i **Blender med kode**: `tools/build_model.py`.
- **Kroppen** er Blender Studios realistiske mannlige base mesh («Human Base Meshes»,
  © Blender Foundation, CC BY 4.0). Den kuttes til en byste, og en tettsittende
  lysegrå ribbestrikket genser legges over den, så bryst og skuldre synes gjennom.
- **Turtleneck** med uregelmessige folder, og en stripe ekte hud under monitoren.
- **Kvadratisk beige retro-monitor** med ventilasjonsriller, svarte øreskiver og en liten lampe.
- Skjelett (`torso → neck1 → neck2 → head`) og innbakte myke skygger (ambient occlusion).

Lag modellen på nytt (skriptet laster ned kroppen automatisk første gang):

```bash
blender -b -P tools/build_model.py
# andre farger:
TVHEAD_KNIT="#2b2b2e" TVHEAD_SKIN="#8d5a3b" TVHEAD_BRAND="JACK" blender -b -P tools/build_model.py
```

## Ledningene

De tynne ledningene er ikke en del av modellen. De simuleres live i nettleseren (`src/cables.js`):
tyngdekraft, treghet, en liten «krøll» som ekte ledninger har, og kollisjon mot bryst, skuldre og hals
(kuler som heter `col_*` i modellen). Noen er festet på genseren, andre henger fritt med en jack-plugg.
Endepunktene (`c0_a` … `c6_b`) settes i `build_cable_anchors` i Blender-skriptet.

## Skjermen

`src/screen.js` bygger bildet som en ekte CRT i tre steg: innhold → fosfor-etterglød → glassrør
med krumning, RGB-striper, scanlines, glød, synk-vingling, rulling ved kanalbytte og strek-av/på-effekt.

Kanaler: ansikt, chart, terminal (agentens tanker) og **dine egne videoer**:

```js
screenVideos: ['videos/ansikt.mp4', 'videos/dans.mp4'],
```

Legg mp4-filer i `videos/`. Korte klipp (5–15 s), helst mørk bakgrunn, gjerne laget i Higgsfield
eller filmet med mobilen. De vises med full CRT-effekt og byttes inn som egne kanaler.

## Bytte til en helt annen 3D-figur

1. **Lag modellen.** Lær Blender gratis (søk «Blender Guru donut tutorial» på YouTube),
   eller start med en AI-generator som Meshy.ai, Tripo3d.ai eller Hyper3D Rodin og rydd opp i Blender.
2. **Rigg den.** Last opp kroppen til Mixamo.com (gratis) for automatisk skjelett,
   eller lag bein selv i Blender som heter `torso`, `neck1`, `neck2` og `head`.
3. **Skjermen.** Gi TV-skjermflaten et materiale som heter nøyaktig `Screen`.
   Da legger siden ansikts-shaderen på den automatisk.
4. **Ekstra (valgfritt).** Tomme objekter som heter `antenna_L` og `antenna_R` svinger etter hodet,
   og et som heter `ScreenLight` bestemmer hvor lyset fra skjermen kommer fra. Et objekt som heter `Sweater` får tickeren brodert på brystet.
5. **Kvalitet.** Bak lys (AO/lightmap) i Blender og hold filen under ~5 MB.
6. **Eksporter** som `.glb` (File → Export → glTF 2.0, gjerne med Draco-komprimering).
7. Legg filen i `models/` og sett `modelUrl: 'models/dinfil.glb'` i `CONFIG`.

Hvis beina ikke blir funnet, står det en advarsel i nettleserkonsollen (F12),
og den innebygde figuren brukes i stedet.

## Kreditering

3D-kroppen er basert på «Human Base Meshes» fra Blender Studio, © Blender Foundation, CC BY 4.0
(https://www.blender.org/download/demo-files/). Studiolyset er fra Poly Haven (CC0).
