# Test Fixture Image Sources

These image assets are used exclusively as local test fixtures in Playwright design capture runs (`tests/e2e/designCapture.spec.ts`). They are strictly excluded from the production build bundle and test runs do not require any external network access.

## Assets

1. **`aot_poster.jpg`**
   - **Subject**: *Attack on Titan* (Shingeki no Kyojin) Volume 1 Key Art
   - **Source**: Wikimedia Commons / Wikipedia (`File:Shingeki_no_Kyojin_manga_volume_1.jpg`)
   - **Direct URL**: `https://upload.wikimedia.org/wikipedia/en/d/d6/Shingeki_no_Kyojin_manga_volume_1.jpg`
   - **Usage in Tests**: Serves as the primary poster for `mockAnime1` / `mockAnimeDetail` (`anime101.jpg`).

2. **`jjk_poster.jpg`**
   - **Subject**: *Jujutsu Kaisen* Volume 1 Key Art
   - **Source**: Wikimedia Commons / Wikipedia (`File:Jujutsu_kaisen.jpg`)
   - **Direct URL**: `https://upload.wikimedia.org/wikipedia/en/4/46/Jujutsu_kaisen.jpg`
   - **Usage in Tests**: Serves as the poster for `mockAnime2` (`anime102.jpg`).

3. **`demonslayer_poster.jpg`**
   - **Subject**: *Demon Slayer: Kimetsu no Yaiba* Volume 1 Key Art
   - **Source**: Wikimedia Commons / Wikipedia (`File:Demon_Slayer_-_Kimetsu_no_Yaiba,_volume_1.jpg`)
   - **Direct URL**: `https://upload.wikimedia.org/wikipedia/en/0/09/Demon_Slayer_-_Kimetsu_no_Yaiba%2C_volume_1.jpg`
   - **Usage in Tests**: Serves as the poster for `mockAnime3` (`anime103.jpg`) / related cards.

4. **`aot_banner.jpg`**
   - **Subject**: *Attack on Titan* Walls Diagram / Landscape Illustration
   - **Source**: Wikimedia Commons (`File:Bymurene_i_Attack_on_Titan.jpg`)
   - **Direct URL**: `https://upload.wikimedia.org/wikipedia/commons/9/9b/Bymurene_i_Attack_on_Titan.jpg`
   - **Usage in Tests**: Serves as the banner image for `mockDiscoverInteresting` (`banner1.jpg`) and screenshot gallery previews (`shot101_1.jpg`, `shot101_2.jpg`).
