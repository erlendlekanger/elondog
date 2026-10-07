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
| `src/style.css` | Utseende på tekst og knapper |

## Endre ting raskt

I `src/main.js`, øverst:

```js
const CONFIG = {
  name: 'TV/HEAD',      // navnet oppe til venstre
  accent: '#ff3a22',    // fargen på ansiktet og lyset
  modelUrl: null,       // din egen 3D-modell, f.eks. 'models/meg.glb'
};
```

Teksten i chatten står i `SCRIPT` lenger ned i samme fil.

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
