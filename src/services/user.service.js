import User from "../models/user.model.js";
import { getNextUid } from "../models/counter.model.js";
import AppError from "../utils/app-error.js";

const PLATFORM_MAP = {
  AZ: "amazon",
  AM: "amazon",
  WB: "website",
  ET: "etsy",
};

function detectPlatform(enrollment) {
  const prefix = enrollment.slice(0, 2).toUpperCase();
  return PLATFORM_MAP[prefix] || null;
}

function buildFieldName(platform, field) {
  const suffix = platform.charAt(0).toUpperCase() + platform.slice(1);
  return `${field}${suffix}`;
}

function generatePassword(uid, name, primaryContact) {
  const uidStr = String(uid);
  const namePrefix = name.slice(0, 2).toUpperCase();
  const mobileSuffix = primaryContact.slice(-2).toUpperCase();
  const raw = `UID${uidStr}@${namePrefix}@${mobileSuffix}`;
  return raw.toUpperCase();
}

function stripPassword(user) {
  const obj = user.toObject();
  delete obj.password;
  return obj;
}

async function resolveManager(managerName, managerCache) {
  if (managerCache && managerCache.has(managerName)) {
    return managerCache.get(managerName);
  }

  const manager = await User.findOne({ name: managerName, role: "manager" }).select("_id name role");

  if (!manager) {
    throw new Error(`${managerName} is not defined as a manager.`);
  }

  if (managerCache) {
    managerCache.set(managerName, manager);
  }

  return manager;
}

async function processUser(userData, managerCache) {
  const { name, email, enrollment, primaryContact, date, batch, manager, enrolledBy } = userData;

  const platform = detectPlatform(enrollment);
  if (!platform) {
    return { status: "skipped", reason: `Unsupported enrollment prefix: ${enrollment.slice(0, 2).toUpperCase()}` };
  }

  let managerUser;
  try {
    managerUser = await resolveManager(manager, managerCache);
  } catch (err) {
    return { status: "skipped", reason: err.message };
  }

  const existingUser = await User.findOne({ primaryContact });

  if (existingUser) {
    const enrollmentField = buildFieldName(platform, "enrollmentId");
    if (existingUser[enrollmentField]) {
      return { status: "skipped", reason: "Enrollment already exists for this contact." };
    }

    const managerField = buildFieldName(platform, "Manager");
    const batchField = buildFieldName(platform, "batch");
    const dateField = buildFieldName(platform, "date");

    existingUser[enrollmentField] = enrollment;
    existingUser[managerField] = managerUser._id;
    existingUser[batchField] = batch;
    existingUser[dateField] = date;

    await existingUser.save();
    return { status: "updated", user: stripPassword(existingUser) };
  }

  const uid = await getNextUid();
  const plainPassword = generatePassword(uid, name, primaryContact);

  const newUserData = {
    uid,
    name,
    email,
    primaryContact,
    password: plainPassword,
    enrolledBy,
    role: "user",
  };

  const enrollmentField = buildFieldName(platform, "enrollmentId");
  const managerField = buildFieldName(platform, "Manager");
  const batchField = buildFieldName(platform, "batch");
  const dateField = buildFieldName(platform, "date");

  newUserData[enrollmentField] = enrollment;
  newUserData[managerField] = managerUser._id;
  newUserData[batchField] = batch;
  newUserData[dateField] = date;

  const newUser = await User.create(newUserData);

  return { status: "created", user: stripPassword(newUser) };
}

export async function createUser(userData) {
  const result = await processUser(userData, null);
  return result;
}

export async function bulkCreateUsers(usersData) {
  const managerCache = new Map();

  const created = [];
  const updated = [];
  const skipped = [];

  for (const userData of usersData) {
    const result = await processUser(userData, managerCache);

    if (result.status === "created") {
      created.push(result.user);
    } else if (result.status === "updated") {
      updated.push(result.user);
    } else {
      skipped.push({
        enrollment: userData.enrollment,
        primaryContact: userData.primaryContact,
        reason: result.reason,
      });
    }
  }

  return { created, updated, skipped };
}

// ─────────────────────────────────────────────
// Users list with server-side search, filter,
// sort, pagination, and RBAC
// ─────────────────────────────────────────────

const SORTABLE_FIELDS = {
  name: "name",
  uid: "uid",
  email: "email",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

export async function getUsers(query, user) {
  const {
    page = 1,
    limit = 10,
    search = "",
    platform = "",
    manager = "",
    batch = "",
    status = "",
    joiningDateFrom = "",
    joiningDateTo = "",
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const skip = (pageNum - 1) * limitNum;

  const matchStage = { role: "user" };

  // ── RBAC: Manager sees only their assigned users ──
  if (user.role === "manager") {
    matchStage.$or = [
      { amazonManager: user.id },
      { websiteManager: user.id },
      { etsyManager: user.id },
    ];
  }

  // ── Search across name, email, primaryContact, UID, enrollment IDs ──
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

    orConditions.push(
      { enrollmentIdAmazon: searchRegex },
      { enrollmentIdWebsite: searchRegex },
      { enrollmentIdEtsy: searchRegex },
    );

    // If manager RBAC already adds $or, we need $and
    if (matchStage.$or) {
      matchStage.$and = [
        { $or: matchStage.$or },
        { $or: orConditions },
      ];
      delete matchStage.$or;
    } else {
      matchStage.$or = orConditions;
    }
  }

  // ── Platform filter ──
  if (platform) {
    const platformLower = platform.toLowerCase();
    if (platformLower === "amazon") {
      matchStage.enrollmentIdAmazon = { $exists: true, $ne: null };
    } else if (platformLower === "website") {
      matchStage.enrollmentIdWebsite = { $exists: true, $ne: null };
    } else if (platformLower === "etsy") {
      matchStage.enrollmentIdEtsy = { $exists: true, $ne: null };
    }
  }

  // ── Manager filter (by manager ObjectId or name) ──
  if (manager) {
    let managerId = manager;
    // If it looks like a name (not an ObjectId), resolve it
    if (!/^[0-9a-fA-F]{24}$/.test(manager)) {
      const managerUser = await User.findOne({ name: manager, role: "manager" }).select("_id").lean();
      if (managerUser) {
        managerId = managerUser._id.toString();
      }
    }
    const managerConditions = [
      { amazonManager: managerId },
      { websiteManager: managerId },
      { etsyManager: managerId },
    ];

    if (matchStage.$and) {
      matchStage.$and.push({ $or: managerConditions });
    } else if (matchStage.$or) {
      matchStage.$and = [
        { $or: matchStage.$or },
        { $or: managerConditions },
      ];
      delete matchStage.$or;
    } else {
      matchStage.$or = managerConditions;
    }
  }

  // ── Batch filter (any platform batch) ──
  if (batch) {
    const batchRegex = { $regex: batch, $options: "i" };
    const batchConditions = [
      { batchAmazon: batchRegex },
      { batchWebsite: batchRegex },
      { batchEtsy: batchRegex },
    ];

    if (matchStage.$and) {
      matchStage.$and.push({ $or: batchConditions });
    } else if (matchStage.$or) {
      matchStage.$and = [
        { $or: matchStage.$or },
        { $or: batchConditions },
      ];
      delete matchStage.$or;
    } else {
      matchStage.$or = batchConditions;
    }
  }

  // ── Status filter ──
  if (status) {
    if (status === "active") {
      matchStage.tokenVersion = { $gte: 0 };
    } else if (status === "inactive") {
      matchStage.tokenVersion = { $lt: 0 };
    }
  }

  // ── Joining date range filter ──
  if (joiningDateFrom || joiningDateTo) {
    const dateFields = ["dateAmazon", "dateWebsite", "dateEtsy"];
    const dateConditions = dateFields.map((field) => {
      const cond = {};
      if (joiningDateFrom) {
        cond[field] = { ...(cond[field] || {}), $gte: joiningDateFrom };
      }
      if (joiningDateTo) {
        cond[field] = { ...(cond[field] || {}), $lte: joiningDateTo };
      }
      return cond;
    });

    if (matchStage.$and) {
      matchStage.$and.push({ $or: dateConditions });
    } else if (matchStage.$or) {
      matchStage.$and = [
        { $or: matchStage.$or },
        { $or: dateConditions },
      ];
      delete matchStage.$or;
    } else {
      matchStage.$or = dateConditions;
    }
  }

  // ── Sort ──
  const sortField = SORTABLE_FIELDS[sortBy] || "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: "users",
        localField: "amazonManager",
        foreignField: "_id",
        as: "amazonManagerData",
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "websiteManager",
        foreignField: "_id",
        as: "websiteManagerData",
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "etsyManager",
        foreignField: "_id",
        as: "etsyManagerData",
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    {
      $lookup: {
        from: "platforms",
        localField: "platforms",
        foreignField: "_id",
        as: "platformsData",
        pipeline: [{ $project: { name: 1, status: 1 } }],
      },
    },
    {
      $addFields: {
        amazonManager: { $arrayElemAt: ["$amazonManagerData", 0] },
        websiteManager: { $arrayElemAt: ["$websiteManagerData", 0] },
        etsyManager: { $arrayElemAt: ["$etsyManagerData", 0] },
        platforms: "$platformsData",
      },
    },
    {
      $project: {
        amazonManagerData: 0,
        websiteManagerData: 0,
        etsyManagerData: 0,
        platformsData: 0,
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

export async function getUserById(userId) {
  const user = await User.findById(userId)
    .select("-password -tokenVersion")
    .populate("amazonManager", "name email")
    .populate("websiteManager", "name email")
    .populate("etsyManager", "name email")
    .populate("platforms", "name status")
    .lean();

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return user;
}

export async function updateUser(userId, updateData) {
  const allowedFields = ["name", "email", "primaryContact", "platforms", "gst", "address"];
  const filtered = {};
  for (const field of allowedFields) {
    if (updateData[field] !== undefined) {
      filtered[field] = updateData[field];
    }
  }

  const user = await User.findByIdAndUpdate(userId, filtered, {
    new: true,
    runValidators: true,
  })
    .select("-password -tokenVersion")
    .populate("amazonManager", "name email")
    .populate("websiteManager", "name email")
    .populate("etsyManager", "name email")
    .populate("platforms", "name status");

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return user;
}

export async function deleteUser(userId) {
  const user = await User.findByIdAndDelete(userId).select("_id name");

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return user;
}
