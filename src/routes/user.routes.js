import { Router } from "express";
import {
  createUser,
  bulkCreateUsers,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
} from "../controllers/user.controller.js";
import validate from "../middlewares/validate.middleware.js";
import { createUserSchema, bulkUserSchema } from "../schemas/user.schema.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";

const router = Router();

router.use(authenticate);

// Static routes first to avoid /:id catching them
router.post("/create", authorize("admin"), validate(createUserSchema), createUser);
router.post("/bulk-create", authorize("admin"), validate(bulkUserSchema, "body"), bulkCreateUsers);

router.get("/", authorize("admin", "supervisor", "manager"), getUsers);
router.get("/:id", authorize("admin", "supervisor", "manager"), getUserById);
router.put("/:id", authorize("admin"), updateUser);
router.delete("/:id", authorize("admin"), deleteUser);

export default router;
