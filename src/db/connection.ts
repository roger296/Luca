import Knex from "knex";
import { config } from "../config/index";

const knex = Knex({
  client: "pg",
  connection: config.database.url,
  pool: config.database.pool,
});

export { knex };
