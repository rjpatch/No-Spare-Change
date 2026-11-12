// The built-in saved copy of the list. The site uses it when the Google Sheet
// link in config.js is blank or can't be reached.
//
// To refresh it: open your Google Sheet, choose File > Download >
// Comma-separated values (.csv), open that file in a text editor, and paste
// everything between the two backtick marks (`) below, replacing what's there.
// The text must not contain a backtick (`) itself.
window.SEED_CSV = String.raw`
id,name,program,neighborhood,borough,address,lat,lng,category,ways_to_help,needs_items,needs_shifts,needs_skills,how_to_help,signup_url,source_url,requirements,book_ahead_note,last_checked,status
coalition-grand-central,Coalition for the Homeless,Grand Central Food Program,Midtown East,Manhattan,"St. Bartholomew's Church, East 51st St between Park and Lexington Aves",40.757222,-73.973003,meals,Weekday evening meal shifts (limited spots) and weekend volunteer drivers,,,,Email the volunteer team,mailto:volunteer@cfthomeless.org,https://secure.coalitionforthehomeless.org/take-action/volunteer/,Weekend drivers commit to regular shifts,Weekday spots are limited,2026-11-10,unverified
holy-apostles,Holy Apostles Soup Kitchen & Pantry,,Chelsea,Manhattan,296 Ninth Ave at West 28th St,40.74927,-73.99882,meals,"Soup kitchen and pantry shifts; times vary, so check their calendar",,,,Sign up on their volunteer calendar,https://hask.volunteerhub.com,https://holyapostlesnyc.org/get-involved/volunteer,No skills needed. Children under 12 come with an adult.,,2026-11-10,unverified
bowery-mission,The Bowery Mission,,Bowery,Manhattan,227 Bowery,40.721989,-73.992853,shelter-services,Daily meal shifts and a weekday clothing room,,,,Sign up on their volunteer calendar,https://bowery.volunteerhub.com/,https://bowery.org/volunteer,18 or older. No felony conviction or court-ordered service. Past clients wait one year.,"Shifts open one month ahead at midnight, and holiday shifts fill early.",2026-11-10,unverified
ny-common-pantry,New York Common Pantry,,East Harlem,Manhattan,8 East 109th St between Fifth and Madison,40.795796,-73.949228,pantry,"Pantry and hot-meal shifts, weekday clerical help, or hosting a food drive",,,,Email volunteer@nycommonpantry.org or call (917) 720-9710 to apply,mailto:volunteer@nycommonpantry.org,https://nycommonpantry.org/?p=899,"Application, then a follow-up. Age 4 and up for pantry and meal shifts.",,2026-11-10,unverified
lenox-hill,Lenox Hill Neighborhood House,,Upper East Side,Manhattan,331 East 70th St between First and Second,40.767102,-73.957728,community-center,"Meal service for older adults and at a women's shelter, English classes, tech help and arts with older adults",,,,Apply on their volunteer page,https://www.lenoxhill.org/volunteer,https://www.lenoxhill.org/volunteer,Application form,,2026-11-10,unverified
`;
