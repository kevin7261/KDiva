export { ARTISTS, findArtist } from '../src/artists.js'

export const DATA_DIR = new URL('../public/data/', import.meta.url)
export const dataFile = (slug) => new URL(`${slug}.json`, DATA_DIR)
export const CONCERTS_DIR = new URL('concerts/', DATA_DIR)
export const concertsFile = (slug) => new URL(`${slug}.json`, CONCERTS_DIR)
export const timelineFile = new URL('timeline.json', DATA_DIR)
export const awardsFile = new URL('awards.json', DATA_DIR)
