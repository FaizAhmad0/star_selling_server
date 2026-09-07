import { Router } from "express";
import { getPlatforms } from "../controllers/platform.controller.js";
import authenticate from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authenticate);

router.get("/", getPlatforms);

export default router;
