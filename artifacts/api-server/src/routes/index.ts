import { Router, type IRouter } from "express";
import healthRouter from "./health.ts";
import adminRouter from "./admin.ts";
import lfollowersRouter from "./lfollowers.ts";
import processOrderRouter from "./processOrder.ts";
import healRouter from "./heal.ts";
import sandboxRouter from "./sandbox.ts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(lfollowersRouter);
router.use(processOrderRouter);
router.use(healRouter);
router.use(sandboxRouter);

export default router;