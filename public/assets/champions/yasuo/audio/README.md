# Yasuo base SFX

These 17 WAV files are decoded from the installed `Yasuo.wad.client` base-skin SFX banks. No voice lines or synthesized substitutes are included.

| File | Exact event suffix after `Play_sfx_Yasuo_` | Seconds | Suggested playback |
|---|---|---:|---|
| attack-1.wav | YasuoBasicAttack_OnCast | 1.896 | Basic swing variant 1 |
| attack-2.wav | YasuoBasicAttack2_OnCast | 1.924 | Basic swing variant 2 |
| attack-3.wav | YasuoBasicAttack3_OnCast | 1.385 | Basic swing variant 3 |
| q-cast.wav | YasuoQW_OnCast | 2.057 | First thrust cast |
| q2-cast.wav | YasuoQ2_OnCast | 2.057 | Second thrust cast |
| q-hit.wav | YasuoQ_hit | 2.843 | Thrust hit |
| q3-cast.wav | YasuoQ3W_OnCast | 2.057 | Third Q cast |
| q3-wind.wav | YasuoQ3W_missilelaunch | 3.098 | Tornado launch |
| q3-hit.wav | YasuoQ3W_hit | 2.433 | Tornado hit |
| w-cast.wav | YasuoWMovingWall_OnCast | 1.990 | Wall cast |
| w-wall.wav | YasuoWMovingWall_buffactivate | 10.524 | Wall active bed; stop when wall expires |
| w-hit.wav | YasuoWMovingWall_hit | 3.023 | Wall impact feedback |
| e-cast.wav | YasuoDashWrapper_cast | 2.400 | Dash begins |
| e-hit.wav | YasuoDashWrapper_hit | 1.600 | Dash hit |
| r-cast.wav | YasuoRDummySpell_OnCast | 3.796 | Ultimate cast |
| r-active.wav | YasuoRKnockUpCombo_OnBuffActivate | 4.658 | Ultimate active sequence |
| r-hit.wav | YasuoRKnockUpCombo_hit_land | 3.971 | Ultimate landing hit |

All files are native 44,100 Hz PCM16. `w-wall.wav` is stereo; the other 16 are mono. Every output was checked for nonzero PCM and zero saturated samples. Combined WAV size is 5,489,762 bytes.

`q-cast.wav` and `q3-cast.wav` intentionally decode to identical PCM: their named events route to the same selected source. The tornado-specific sound is `q3-wind.wav`. Attack cast variants 1/2/3 have different decoded hashes. Basic-attack OnHit events depend on an unidentified Wwise switch, so this set does not invent a generic hit selection.

There is no distinct R-end Play event in the inspected base skin metadata. Stop/fade `r-active.wav` at cancellation/end and play `r-hit.wav` on the accepted landing hit; let that impact tail finish. The same end event should not immediately stop the landing sound. Play each exported file once, not as an indefinite loop. Stop/fade the wall bed at wall expiration; its 10.524-second source length is not the wall's gameplay duration. Runtime volume changes are not inferred from this static source duration.

## Evidence and reproduction

`audio-manifest.json` records exact event names, Wwise lowercase FNV-1 event IDs, local metadata file offsets, media IDs, complete generated TXTP routing, bank hashes and decoded WAV hashes. Names were read from length-prefixed strings in local `root.bin` and `skin0.bin`, then independently matched to actual CAkEvent IDs in the event bank. Wadtools warned about newer BIN property types while recovering paths; the extracted string offsets and bank event IDs were independently verified.

Working inputs and reproducible scripts are in sibling `yasuo-work/audio/`. The extraction contains only base SFX audio/event banks and the two metadata BIN files. Existing tools in `garen-viewer/tools/` were reused: [wadtools 0.5.7](https://github.com/LeagueToolkit/wadtools/releases/tag/v0.5.7), [wwiser v20260808](https://github.com/bnnm/wwiser/releases/tag/v20260808), [vgmstream r2168](https://github.com/vgmstream/vgmstream/releases/tag/r2168).

From the Web_game checkout, the reproduction sequence is:

```powershell
& ../garen-viewer/tools/wadtools/wadtools.exe --hashtable-dir ../garen-viewer/tools/hashes extract -i 'C:/Riot Games/League of Legends/Game/DATA/FINAL/Champions/Yasuo.wad.client' -o ../yasuo-work/audio/extracted -x '(skins/base/.*sfx.*bnk$|data/characters/yasuo/skins/(skin0|root)\.bin$)'
python ../yasuo-work/audio/scan_events.py
python ../garen-viewer/tools/wwiser.pyz ../yasuo-work/audio/extracted/assets/sounds/wwise2016/sfx/characters/yasuo/skins/base/yasuo_base_sfx_events.bnk ../yasuo-work/audio/extracted/assets/sounds/wwise2016/sfx/characters/yasuo/skins/base/yasuo_base_sfx_audio.bnk -nl ../yasuo-work/audio/wwnames.txt -d txt -dn ../yasuo-work/audio/base-dump -g -gd -gv 0.99 -go ../yasuo-work/audio/txtp
python ../yasuo-work/audio/decode_audio.py
```

The renderer preserves authored layers and source gains, selects the first alternative in each random container, and uses master gain 0.99 to avoid automatic amplification. Vgmstream `-i` decodes one source pass. Wwise buses, runtime game variables, attenuation, reverb, ducking, full random selection and original game timing are not reproduced. These are original decoded media played by a reconstructed browser audio system.

Riot Games retains rights to the source audio. The extraction task prepared these files for local integration and did not upload or commit them.
