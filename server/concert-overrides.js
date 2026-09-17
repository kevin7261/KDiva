// 手動補充演唱會：Wikipedia 沒列出的場次或整個演唱會，填在這裡再重新抓取（npm run fetch-concerts -- <slug>）。
// tour 寫演唱會名稱（和網站上顯示的名稱相同或相近即可），找不到同名的演唱會時會新增一個。
// shows 的 date 寫 YYYY-MM-DD；只知道月份寫 YYYY-MM。
export const CONCERT_OVERRIDES = {
  // 'valen-hsu': [
  //   {
  //     tour: '適合相愛的時辰巡迴演唱會',
  //     shows: [{ date: '2025-06-01', region: '中國大陸', city: '鄭州', venue: '○○體育館' }],
  //   },
  // ],
}
