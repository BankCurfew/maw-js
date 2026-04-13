import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { sessionsApi } from "./sessions";
import { feedApi } from "./feed";
import { teamsApi } from "./teams";
import { configApi } from "./config";
import { fleetApi } from "./fleet";
import { asksApi } from "./asks";
import { oracleApi } from "./oracle";
import { federationApi } from "./federation";
import { worktreesApi } from "./worktrees";
import { uiStateApi } from "./ui-state";
import { deprecatedApi } from "./deprecated";
import { costsApi } from "./costs";
import { triggersApi } from "./triggers";
import { avengersApi } from "./avengers";
import { transportApi } from "./transport";
import { workspaceApi } from "./workspace";
import { peerExecApi } from "./peer-exec";
import { proxyApi } from "./proxy";
import { pulseApi } from "./pulse";
// TODO (#312): migrate federationAuth to Elysia guard()
// import { federationAuth } from "../lib/federation-auth";

export const api = new Elysia({ prefix: "/api" })
  .use(cors())
  .use(swagger({
    path: "/docs",
    documentation: {
      info: { title: "maw-js API", version: "2.0.0-alpha.1" },
      description: "Multi-Agent Workflow API — federation, sessions, plugins, workspace",
    },
  }))
  .use(sessionsApi)
  .use(feedApi)
  .use(teamsApi)
  .use(configApi)
  .use(fleetApi)
  .use(asksApi)
  .use(oracleApi)
  .use(federationApi)
  .use(worktreesApi)
  .use(uiStateApi)
  .use(deprecatedApi)
  .use(costsApi)
  .use(triggersApi)
  .use(avengersApi)
  .use(transportApi)
  .use(workspaceApi)
  .use(peerExecApi)
  .use(proxyApi)
  .use(pulseApi);
