# Original Summoner's Rift inhibitor

Extracted from the local League of Legends Map11.wad.client using `test/export_sr_objects.py`.

Blue is Order skin0; red is Chaos skin3. The manifest records original model, skin, skeleton, animation graph and texture SHA-256 hashes, clips and initial/transition submesh visibility. GLBs embed textures, skeletons and original clips. Coordinates remain unscaled. The runtime must hide `Destroyed` while alive and swap visibility on death as recorded in the source graph.

Particle effects and sound are not embedded in these skeletal assets.
