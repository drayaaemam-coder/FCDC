const config = require("./config");
const app = require("./app");

app.listen(config.port, () => console.log(`FCDC tracker running on http://localhost:${config.port}`));
