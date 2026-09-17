export { ARTISTS, findArtist } from '../src/artists.js'

export const DATA_DIR = new URL('../public/data/', import.meta.url)
export const dataFile = (slug) => new URL(`${slug}.json`, DATA_DIR)
export const CONCERTS_DIR = new URL('concerts/', DATA_DIR)
export const concertsFile = (slug) => new URL(`${slug}.json`, CONCERTS_DIR)
export const timelineFile = new URL('timeline.json', DATA_DIR)
export const awardsFile = new URL('awards.json', DATA_DIR)
export const writtenFile = new URL('written.json', DATA_DIR)
// 生卒／成軍解散，只收有資料的那幾位；年表檔 1.2MB 太重，名單頁只為了年份不該載入它
export const bioFile = new URL('bio.json', DATA_DIR)
