import { Router } from "express";
import { getManagers, getManagerById } from "../controllers/manager.controller.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("admin", "supervisor"), getManagers);
router.get("/:id", authorize("admin", "supervisor"), getManagerById);

export default router;
