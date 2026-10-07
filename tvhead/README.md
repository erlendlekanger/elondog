# TV/HEAD

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
| `src/agent.js` | Agent-feeden, humør og chartet på TV-skjermen |
| `assets/studio.hdr` | Studiolys for refleksjoner (Poly Haven, CC0) |
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

## Bytte til din egen 3D-figur (som Lisa)

1. **Lag modellen.** Lær Blender gratis (søk «Blender Guru donut tutorial» på YouTube),
   eller start med en AI-generator som Meshy.ai, Tripo3d.ai eller Hyper3D Rodin og rydd opp i Blender.
2. **Rigg den.** Last opp kroppen til Mixamo.com (gratis) for automatisk skjelett,
   eller lag bein selv i Blender som heter `torso`, `neck1` og `neck2`.
3. **Skjermen.** Gi TV-skjermflaten et materiale som heter nøyaktig `Screen`.
   Da legger siden ansikts-shaderen på den automatisk.
4. **Kvalitet.** Bak lys (AO/lightmap) i Blender, slik Lisa gjør, og hold filen under ~5 MB.
5. **Eksporter** som `.glb` (File → Export → glTF 2.0, gjerne med Draco-komprimering).
6. Legg filen i `models/` og sett `modelUrl: 'models/dinfil.glb'` i `CONFIG`.

Hvis beina ikke blir funnet, står det en advarsel i nettleserkonsollen (F12),
og den innebygde figuren brukes i stedet.
