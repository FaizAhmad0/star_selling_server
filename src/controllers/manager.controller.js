import * as managerService from "../services/manager.service.js";
import { sendSuccess } from "../utils/response.js";
import asyncHandler from "../utils/async-handler.js";

export const getManagers = asyncHandler(async (req, res) => {
  const result = await managerService.getManagers(req.query);

  return sendSuccess(res, {
    message: "Managers fetched successfully",
    data: result,
  });
});

export const getManagerById = asyncHandler(async (req, res) => {
  const manager = await managerService.getManagerById(req.params.id);

  return sendSuccess(res, {
    message: "Manager fetched successfully",
    data: manager,
  });
});
