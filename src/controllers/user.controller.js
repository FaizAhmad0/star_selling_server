import * as userService from "../services/user.service.js";
import { sendSuccess, sendError } from "../utils/response.js";
import asyncHandler from "../utils/async-handler.js";

export const createUser = asyncHandler(async (req, res) => {
  const result = await userService.createUser(req.body);

  if (result.status === "created") {
    return sendSuccess(res, {
      message: "User created successfully",
      data: result.user,
      statusCode: 201,
    });
  }

  if (result.status === "updated") {
    return sendSuccess(res, {
      message: "Existing user updated with new enrollment information",
      data: result.user,
    });
  }

  return sendError(res, {
    message: result.reason,
    statusCode: 409,
  });
});

export const bulkCreateUsers = asyncHandler(async (req, res) => {
  const result = await userService.bulkCreateUsers(req.body);

  return sendSuccess(res, {
    message: "Bulk user processing completed",
    data: {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
    },
  });
});

export const getUsers = asyncHandler(async (req, res) => {
  const result = await userService.getUsers(req.query, req.user);

  return sendSuccess(res, {
    message: "Users fetched successfully",
    data: result,
  });
});

export const getUserById = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.params.id);

  return sendSuccess(res, {
    message: "User fetched successfully",
    data: user,
  });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body);

  return sendSuccess(res, {
    message: "User updated successfully",
    data: user,
  });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await userService.deleteUser(req.params.id);

  return sendSuccess(res, {
    message: "User deleted successfully",
    data: { id: user._id },
  });
});
