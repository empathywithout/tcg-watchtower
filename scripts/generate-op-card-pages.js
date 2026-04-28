name: Generate One Piece Card Pages

on:
  workflow_dispatch:
    inputs:
      set_id:
        description: 'Set ID (op15, op14, eb04...)'
        required: true
        default: 'op15'
      set_full_name:
        description: 'Full set name e.g. "Adventure on Kami\'s Island"'
        required: true
        default: "Adventure on Kami's Island"
      set_short_name:
        description: 'Short badge e.g. OP15'
        required: false
        default: 'OP15'
      set_url_slug:
        description: 'URL slug e.g. adventure-on-kamis-island'
        required: true
        default: 'adventure-on-kamis-island'
      tcgp_group_id:
        description: 'TCGplayer groupId'
        required: false
        default: '24637'

jobs:
  generate-card-pages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Generate One Piece card pages
        env:
          SET_ID:           ${{ github.event.inputs.set_id }}
          SET_FULL_NAME:    ${{ github.event.inputs.set_full_name }}
          SET_SHORT_NAME:   ${{ github.event.inputs.set_short_name }}
          SET_URL_SLUG:     ${{ github.event.inputs.set_url_slug }}
          TCGP_GROUP_ID:    ${{ github.event.inputs.tcgp_group_id }}
          CF_R2_PUBLIC_URL: ${{ secrets.CF_R2_PUBLIC_URL }}
        run: node scripts/generate-op-card-pages.js

      - name: Commit generated pages
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          git diff --cached --quiet || git commit -m "Generate One Piece ${{ github.event.inputs.set_id }} individual card pages"
          git push
