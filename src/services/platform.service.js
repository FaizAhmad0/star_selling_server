import Platform from "../models/platform.model.js";

export async function getPlatforms(query) {
  const { search = "", status = "" } = query;

  const matchStage = {};

  if (search) {
    matchStage.name = { $regex: search, $options: "i" };
  }

  if (status) {
    matchStage.status = status;
  }

  const platforms = await Platform.find(matchStage).sort({ name: 1 }).lean();

  return platforms;
}
