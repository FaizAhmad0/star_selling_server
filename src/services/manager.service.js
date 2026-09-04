import User from "../models/user.model.js";
import Platform from "../models/platform.model.js";
import AppError from "../utils/app-error.js";

const SORTABLE_FIELDS = {
  name: "name",
  uid: "uid",
  email: "email",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

export async function getManagers(query) {
  const {
    page = 1,
    limit = 10,
    search = "",
    platform = "",
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const skip = (pageNum - 1) * limitNum;

  const matchStage = { role: "manager" };

  if (search) {
    const searchRegex = { $regex: search, $options: "i" };
    const orConditions = [
      { name: searchRegex },
      { email: searchRegex },
      { primaryContact: searchRegex },
    ];
    const uidNum = parseInt(search, 10);
    if (!isNaN(uidNum)) {
      orConditions.push({ uid: uidNum });
    }
    matchStage.$or = orConditions;
  }

  if (platform) {
    if (/^[0-9a-fA-F]{24}$/.test(platform)) {
      matchStage.platform = platform;
    } else {
      const platformDoc = await Platform.findOne({ name: { $regex: `^${platform}$`, $options: "i" } }).select("_id").lean();
      if (platformDoc) {
        matchStage.platform = platformDoc._id;
      }
    }
  }

  const sortField = SORTABLE_FIELDS[sortBy] || "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: "users",
        let: { managerId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$amazonManager", "$$managerId"] },
                  { $eq: ["$websiteManager", "$$managerId"] },
                  { $eq: ["$etsyManager", "$$managerId"] },
                ],
              },
              role: "user",
            },
          },
          { $count: "count" },
        ],
        as: "assignedUsersData",
      },
    },
    {
      $lookup: {
        from: "platforms",
        localField: "platform",
        foreignField: "_id",
        as: "platformData",
        pipeline: [{ $project: { name: 1, status: 1 } }],
      },
    },
    {
      $addFields: {
        assignedUsers: { $ifNull: [{ $arrayElemAt: ["$assignedUsersData.count", 0] }, 0] },
        platform: { $arrayElemAt: ["$platformData", 0] },
      },
    },
    {
      $project: {
        assignedUsersData: 0,
        platformData: 0,
        password: 0,
        tokenVersion: 0,
        __v: 0,
      },
    },
    { $sort: { [sortField]: sortDir } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limitNum }],
        totalCount: [{ $count: "total" }],
      },
    },
  ];

  const [result] = await User.aggregate(pipeline);
  const data = result.data;
  const total = result.totalCount[0]?.total || 0;
  const totalPages = Math.ceil(total / limitNum);

  return {
    data,
    meta: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    },
  };
}

export async function getManagerById(managerId) {
  const manager = await User.findOne({ _id: managerId, role: "manager" })
    .select("-password -tokenVersion")
    .populate("platform", "name status")
    .lean();

  if (!manager) {
    throw new AppError("Manager not found", 404);
  }

  return manager;
}
