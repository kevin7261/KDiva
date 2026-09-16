// 各歌手在 YouTube Music 的官方藝人頻道與 Wikipedia 條目；slug 用於網址與資料檔名。
// 前端與 Node 抓取腳本共用這份清單。
export const ARTISTS = [
  { slug: 'valen-hsu', name: '許茹芸', en: 'Valen Hsu', channelId: 'UCZgpCUQ69DOR8OUKAxD8exw', wiki: '許茹芸' },
  { slug: 'winnie-hsin', name: '辛曉琪', en: 'Winnie Hsin', channelId: 'UCmC8dCKfO3ZZtxYNvkadmxA', wiki: '辛曉琪' },
  { slug: 'a-mei', name: '張惠妹', en: 'A-Mei', channelId: 'UC5M7vIbPTCOMVF3lTtbeO6g', wiki: '張惠妹' },
  { slug: 'tanya-chua', name: '蔡健雅', en: 'Tanya Chua', channelId: 'UCKbk-Nog0Sac_NHWntf3RHQ', wiki: '蔡健雅' },
  { slug: 'jolin-tsai', name: '蔡依林', en: 'Jolin Tsai', channelId: 'UC9dLsF7Ss7Wg0kR6TiIWiXg', wiki: '蔡依林' },
]

export const findArtist = (slug) => ARTISTS.find((a) => a.slug === slug)
