import * as platformService from "../services/platform.service.js";
import { sendSuccess } from "../utils/response.js";
import asyncHandler from "../utils/async-handler.js";

export const getPlatforms = asyncHandler(async (req, res) => {
  const result = await platformService.getPlatforms(req.query);

  return sendSuccess(res, {
    message: "Platforms fetched successfully",
    data: result,
  });
});
