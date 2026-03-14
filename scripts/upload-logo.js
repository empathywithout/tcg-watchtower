name: Upload Set Logo to R2

on:
  workflow_dispatch:
    inputs:
      set_id:
        description: 'Set ID (e.g. sv05)'
        required: true
      logo_filename:
        description: 'Logo filename in scripts/ folder (e.g. sv05-logo.png)'
        required: true

jobs:
  upload-logo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Upload logo to R2
        env:
          R2_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.CF_R2_ACCESS_KEY }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.CF_R2_SECRET_KEY }}
          R2_BUCKET_NAME: ${{ secrets.CF_R2_BUCKET }}
          R2_PUBLIC_URL: ${{ secrets.CF_R2_PUBLIC_URL }}
          SET_ID: ${{ github.event.inputs.set_id }}
          LOGO_FILE: scripts/${{ github.event.inputs.logo_filename }}
        run: node scripts/upload-logo.js
