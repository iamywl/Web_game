# Garen base skill SFX

Extracted from the installed `Garen.wad.client`, base-skin SFX audio and event banks. No synthesized replacement sound or voice line is included.

| File | Wwise event suffix after `Play_sfx_Garen_` | Duration | Trigger |
|---|---|---:|---|
| q-cast.wav | GarenQ_OnCast | 3.265 s | Q activation |
| q-attack.wav | GarenQAttack_OnCast | 2.957 s | Empowered Q attack swing |
| w-cast.wav | GarenW_OnCast | 2.992 s | W activation |
| e-cast.wav | GarenE_OnCast | 2.553 s | E activation |
| e-loop.wav | GarenE_OnBuffActivate | 3.488 s | E active sound bed, play once |
| e-hit.wav | GarenE_hit | 1.134 s | E impact; avoid stacking this every render frame |
| e-end.wav | GarenE_OnBuffDeactivate | 2.149 s | E ends / cancels |
| r-cast.wav | GarenR_OnCast | 2.335 s | R cast starts |
| r-hit.wav | GarenR_OnHit | 4.284 s | R impact |

`e-loop.wav` is named for its gameplay role. The actual selected Wwise source has no loop markers and is an approximately 3.49-second one-shot. Start it once per E and fade/stop on cancellation; do not infinitely repeat it. No dedicated Q OnHit event was found, so the empowered swing is accurately named `q-attack.wav`.

## Evidence and conversion

`audio-manifest.json` records exact event names, event IDs verified using Wwise lowercase FNV-1, source media IDs, original metadata file offsets, complete generated TXTP routing, bank hashes and WAV hashes. Event names came from length-prefixed strings in the local champion BIN files. Those names resolve to existing event IDs in the local `garen_base_sfx_events.bnk` and media in `garen_base_sfx_audio.bnk`.

Tools: [wadtools 0.5.7](https://github.com/LeagueToolkit/wadtools/releases/tag/v0.5.7), [wwiser v20260808](https://github.com/bnnm/wwiser/releases/tag/v20260808), [vgmstream r2168](https://github.com/vgmstream/vgmstream/releases/tag/r2168). Working extraction files, exact named TXTP routing and reproducible decoding script are in sibling `garen-viewer/work/audio/`; executables remain in `garen-viewer/tools/`.

All outputs are native-rate 44,100 Hz, mono PCM16 WAV, decoded with vgmstream `-i` (one source pass). Author-defined layers and per-source gains are retained; a deterministic first choice is rendered for each random container. `wwiser -gv 0.99` disables automatic amplification while adding approximately 0.1 dB of headroom. Default automatic amplification was found to clip; those intermediate files were replaced. Final verification checks all nine WAVs are nonempty, contain nonzero PCM and have **zero saturated samples**.

Global Wwise buses, runtime ducking/reverb/attenuation, RNG variants and game-specific timing are not reconstructed. The event samples are original decoded game media; their browser playback is a reconstruction of the original audio system. The Korean WAD was inspected and contains voice banks; it was not needed for these base-skin SFX.

Riot Games retains rights to the extracted audio. These files were prepared for local integration and have not been uploaded or committed by the extraction task.
