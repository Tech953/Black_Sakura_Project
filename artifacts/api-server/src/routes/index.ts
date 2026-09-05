import { Router, type IRouter } from "express";
import healthRouter from "./health";
import personalityRouter from "./personality";
import memoriesRouter from "./memories";
import journalRouter from "./journal";
import personasRouter from "./personas";
import beliefsRouter from "./beliefs";
import evolutionRouter from "./evolution";
import initiativeRouter from "./initiative";
import hieroRouter from "./hiero";
import expressionsRouter from "./expressions";
import statsRouter from "./stats";
import openaiRouter from "./openai";
import engramsRouter from "./engrams";
import engramWorldModelRouter from "./engram-world-model";
import hubRouter from "./hub";
import messagesRouter from "./messages";
import simulationsRouter from "./simulations";
import mediaRouter from "./media";
import artifactsRouter from "./artifacts";
import eventsRouter from "./events";
import downloadRouter from "./download";
import offlineSyncRouter from "./offline-sync";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

router.use(healthRouter);
// These endpoints contain no account data and are intentionally public so
// installers can be discovered before a user signs in.
router.use(downloadRouter);

// Every remaining HTTP, SSE, and offline-sync endpoint derives its account
// identity exclusively from Clerk. Route handlers must scope reads/writes by
// req.userId and never accept an owner identifier from the request.
router.use(requireAuth);
router.use(personalityRouter);
router.use(memoriesRouter);
router.use(journalRouter);
router.use(personasRouter);
router.use(beliefsRouter);
router.use(evolutionRouter);
router.use(initiativeRouter);
router.use(hieroRouter);
router.use(expressionsRouter);
router.use(statsRouter);
router.use(openaiRouter);
router.use(engramsRouter);
router.use(engramWorldModelRouter);
router.use(hubRouter);
router.use(messagesRouter);
router.use(simulationsRouter);
router.use(mediaRouter);
router.use(artifactsRouter);
router.use(eventsRouter);
router.use(offlineSyncRouter);

export default router;
