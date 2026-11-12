// Settings for the site. Change only the text between the quote marks,
// and keep the quote marks and the comma at the end of each line.
window.CONFIG = {
  // The "Publish to web" CSV link for the orgs tab of your Google Sheet. Blank = use the saved copy in data/seed.js.
  SHEET_CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKWUlhr8OMHtqfBC3ftUfbpI-rUudRESu_oEKvuDvyqUok_Umg__I5viI9fyfS8zUW0DcAJJLyr-R7/pub?gid=510329143&single=true&output=csv",

  // The email address shown in the footer for organizations to reach you. Blank = that footer line is hidden.
  CONTACT_EMAIL: "createmailforthis",

  // Your Cloudflare Web Analytics token. Blank = analytics is off.
  CF_ANALYTICS_TOKEN: "",

  // Where the map background pictures come from. {z}, {x} and {y} are filled in by the map.
  TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

  // The credit shown in the corner of the map. It must match whoever provides the map background.
  TILE_ATTRIBUTION: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',

  // After this many days since last_checked, a listing says "May be out of date."
  STALE_DAYS: 45,

  // After this many days since last_checked, a listing is no longer shown.
  HIDE_DAYS: 60
};
