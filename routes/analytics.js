const express = require('express');
const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Get dashboard analytics
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Get basic counts
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalJobs = await Job.countDocuments({ ...dateFilter });
    const totalApplications = await Application.countDocuments({ ...dateFilter });
    const totalEmployers = await User.countDocuments({ role: 'employer' });

    // Get placement statistics
    const placedStudents = await User.countDocuments({
      role: 'student',
      'studentInfo.isPlaced': true
    });

    const unplacedStudents = totalStudents - placedStudents;
    const placementRate = totalStudents > 0 ? (placedStudents / totalStudents * 100).toFixed(2) : 0;

    // Get application status distribution
    const applicationStatusStats = await Application.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get job status distribution
    const jobStatusStats = await Job.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get department-wise statistics
    const departmentStats = await User.aggregate([
      { $match: { role: 'student', ...dateFilter } },
      {
        $group: {
          _id: '$studentInfo.department',
          total: { $sum: 1 },
          placed: {
            $sum: { $cond: ['$studentInfo.isPlaced', 1, 0] }
          }
        }
      },
      {
        $addFields: {
          placementRate: {
            $multiply: [
              { $divide: ['$placed', '$total'] },
              100
            ]
          }
        }
      }
    ]);

    // Get monthly application trends
    const monthlyTrends = await Application.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get top companies by applications
    const topCompanies = await Application.aggregate([
      { $match: dateFilter },
      {
        $lookup: {
          from: 'jobs',
          localField: 'job',
          foreignField: '_id',
          as: 'jobData'
        }
      },
      { $unwind: '$jobData' },
      {
        $group: {
          _id: '$jobData.company.name',
          applicationCount: { $sum: 1 },
          hiredCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      },
      { $sort: { applicationCount: -1 } },
      { $limit: 10 }
    ]);

    // Get skill demand analysis
    const skillDemand = await Job.aggregate([
      { $match: { ...dateFilter, status: 'active' } },
      { $unwind: '$requirements.skills' },
      {
        $group: {
          _id: '$requirements.skills',
          demand: { $sum: 1 }
        }
      },
      { $sort: { demand: -1 } },
      { $limit: 20 }
    ]);

    const analytics = {
      overview: {
        totalStudents,
        totalJobs,
        totalApplications,
        totalEmployers,
        placedStudents,
        unplacedStudents,
        placementRate: parseFloat(placementRate)
      },
      applicationStatus: applicationStatusStats,
      jobStatus: jobStatusStats,
      departmentStats,
      monthlyTrends,
      topCompanies,
      skillDemand
    };

    res.json({
      analytics
    });
  } catch (error) {
    console.error('Get dashboard analytics error:', error);
    res.status(500).json({
      message: 'Failed to get dashboard analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get placement analytics
router.get('/placement', authenticateToken, authorize('admin', 'faculty'), async (req, res) => {
  try {
    const { startDate, endDate, department, year } = req.query;
    
    const filters = {};
    if (startDate && endDate) {
      filters.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (department) {
      filters['studentInfo.department'] = department;
    }

    if (year) {
      filters['studentInfo.year'] = parseInt(year);
    }

    // Get placement statistics
    const placementStats = await User.aggregate([
      { $match: { role: 'student', ...filters } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          placed: {
            $sum: { $cond: ['$studentInfo.isPlaced', 1, 0] }
          },
          unplaced: {
            $sum: { $cond: ['$studentInfo.isPlaced', 0, 1] }
          }
        }
      }
    ]);

    // Get placement by department
    const placementByDepartment = await User.aggregate([
      { $match: { role: 'student', ...filters } },
      {
        $group: {
          _id: '$studentInfo.department',
          total: { $sum: 1 },
          placed: {
            $sum: { $cond: ['$studentInfo.isPlaced', 1, 0] }
          }
        }
      },
      {
        $addFields: {
          placementRate: {
            $multiply: [
              { $divide: ['$placed', '$total'] },
              100
            ]
          }
        }
      },
      { $sort: { placementRate: -1 } }
    ]);

    // Get placement by year
    const placementByYear = await User.aggregate([
      { $match: { role: 'student', ...filters } },
      {
        $group: {
          _id: '$studentInfo.year',
          total: { $sum: 1 },
          placed: {
            $sum: { $cond: ['$studentInfo.isPlaced', 1, 0] }
          }
        }
      },
      {
        $addFields: {
          placementRate: {
            $multiply: [
              { $divide: ['$placed', '$total'] },
              100
            ]
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get top hiring companies
    const topHiringCompanies = await User.aggregate([
      { $match: { role: 'student', 'studentInfo.isPlaced': true, ...filters } },
      {
        $group: {
          _id: '$studentInfo.placementDetails.company',
          hiredCount: { $sum: 1 }
        }
      },
      { $sort: { hiredCount: -1 } },
      { $limit: 10 }
    ]);

    // Get package distribution
    const packageDistribution = await User.aggregate([
      { $match: { role: 'student', 'studentInfo.isPlaced': true, ...filters } },
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $lt: ['$studentInfo.placementDetails.package', 500000] }, then: 'Below 5L' },
                { case: { $lt: ['$studentInfo.placementDetails.package', 1000000] }, then: '5L-10L' },
                { case: { $lt: ['$studentInfo.placementDetails.package', 1500000] }, then: '10L-15L' },
                { case: { $lt: ['$studentInfo.placementDetails.package', 2000000] }, then: '15L-20L' }
              ],
              default: 'Above 20L'
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const analytics = {
      placementStats: placementStats[0] || { total: 0, placed: 0, unplaced: 0 },
      placementByDepartment,
      placementByYear,
      topHiringCompanies,
      packageDistribution
    };

    res.json({
      analytics
    });
  } catch (error) {
    console.error('Get placement analytics error:', error);
    res.status(500).json({
      message: 'Failed to get placement analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get application analytics
router.get('/applications', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, jobId, studentId, employerId } = req.query;
    
    const filters = {};
    if (startDate && endDate) {
      filters.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (jobId) {
      filters.job = jobId;
    }

    if (studentId) {
      filters.student = studentId;
    }

    if (employerId) {
      // Get jobs posted by this employer
      const jobs = await Job.find({ postedBy: employerId }).select('_id');
      const jobIds = jobs.map(job => job._id);
      filters.job = { $in: jobIds };
    }

    // Get application status distribution
    const statusDistribution = await Application.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get application trends over time
    const applicationTrends = await Application.aggregate([
      { $match: filters },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Get conversion funnel
    const conversionFunnel = await Application.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          shortlisted: {
            $sum: { $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0] }
          },
          interviewed: {
            $sum: { $cond: [{ $in: ['$status', ['interview-scheduled', 'interview-completed']] }, 1, 0] }
          },
          offered: {
            $sum: { $cond: [{ $eq: ['$status', 'offer-extended'] }, 1, 0] }
          },
          hired: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      }
    ]);

    // Get top performing jobs
    const topJobs = await Application.aggregate([
      { $match: filters },
      {
        $lookup: {
          from: 'jobs',
          localField: 'job',
          foreignField: '_id',
          as: 'jobData'
        }
      },
      { $unwind: '$jobData' },
      {
        $group: {
          _id: '$jobData.title',
          company: { $first: '$jobData.company.name' },
          totalApplications: { $sum: 1 },
          hired: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      },
      {
        $addFields: {
          conversionRate: {
            $multiply: [
              { $divide: ['$hired', '$totalApplications'] },
              100
            ]
          }
        }
      },
      { $sort: { totalApplications: -1 } },
      { $limit: 10 }
    ]);

    const analytics = {
      statusDistribution,
      applicationTrends,
      conversionFunnel: conversionFunnel[0] || {
        total: 0,
        shortlisted: 0,
        interviewed: 0,
        offered: 0,
        hired: 0
      },
      topJobs
    };

    res.json({
      analytics
    });
  } catch (error) {
    console.error('Get application analytics error:', error);
    res.status(500).json({
      message: 'Failed to get application analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get job analytics
router.get('/jobs', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, employerId, category, type } = req.query;
    
    const filters = {};
    if (startDate && endDate) {
      filters.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (employerId) {
      filters.postedBy = employerId;
    }

    if (category) {
      filters.category = category;
    }

    if (type) {
      filters.type = type;
    }

    // Get job status distribution
    const jobStatusDistribution = await Job.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get job trends over time
    const jobTrends = await Job.aggregate([
      { $match: filters },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get category distribution
    const categoryDistribution = await Job.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get type distribution
    const typeDistribution = await Job.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get top companies by job posts
    const topCompanies = await Job.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$company.name',
          jobCount: { $sum: 1 },
          totalViews: { $sum: '$analytics.views' },
          totalApplications: { $sum: '$analytics.applications' }
        }
      },
      { $sort: { jobCount: -1 } },
      { $limit: 10 }
    ]);

    // Get skill demand
    const skillDemand = await Job.aggregate([
      { $match: { ...filters, status: 'active' } },
      { $unwind: '$requirements.skills' },
      {
        $group: {
          _id: '$requirements.skills',
          demand: { $sum: 1 }
        }
      },
      { $sort: { demand: -1 } },
      { $limit: 20 }
    ]);

    const analytics = {
      jobStatusDistribution,
      jobTrends,
      categoryDistribution,
      typeDistribution,
      topCompanies,
      skillDemand
    };

    res.json({
      analytics
    });
  } catch (error) {
    console.error('Get job analytics error:', error);
    res.status(500).json({
      message: 'Failed to get job analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get feedback analytics
router.get('/feedback', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, type, studentId, employerId } = req.query;
    
    const filters = {};
    if (startDate && endDate) {
      filters.submittedAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (type) {
      filters.type = type;
    }

    if (studentId) {
      filters.student = studentId;
    }

    if (employerId) {
      filters.employer = employerId;
    }

    // Get feedback statistics
    const feedbackStats = await Feedback.getStatistics(filters);

    // Get rating distribution
    const ratingDistribution = await Feedback.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$rating.overall',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get feedback trends over time
    const feedbackTrends = await Feedback.aggregate([
      { $match: filters },
      {
        $group: {
          _id: {
            year: { $year: '$submittedAt' },
            month: { $month: '$submittedAt' }
          },
          count: { $sum: 1 },
          averageRating: { $avg: '$rating.overall' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get feedback by type
    const feedbackByType = await Feedback.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          averageRating: { $avg: '$rating.overall' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get top rated students
    const topRatedStudents = await Feedback.aggregate([
      { $match: filters },
      {
        $lookup: {
          from: 'users',
          localField: 'student',
          foreignField: '_id',
          as: 'studentData'
        }
      },
      { $unwind: '$studentData' },
      {
        $group: {
          _id: '$student',
          name: { $first: { $concat: ['$studentData.firstName', ' ', '$studentData.lastName'] } },
          averageRating: { $avg: '$rating.overall' },
          feedbackCount: { $sum: 1 }
        }
      },
      { $match: { feedbackCount: { $gte: 2 } } },
      { $sort: { averageRating: -1 } },
      { $limit: 10 }
    ]);

    const analytics = {
      feedbackStats: feedbackStats[0] || {
        totalFeedbacks: 0,
        averageRating: 0,
        highRatings: 0,
        lowRatings: 0
      },
      ratingDistribution,
      feedbackTrends,
      feedbackByType,
      topRatedStudents
    };

    res.json({
      analytics
    });
  } catch (error) {
    console.error('Get feedback analytics error:', error);
    res.status(500).json({
      message: 'Failed to get feedback analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Export analytics data
router.get('/export/:type', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate, format = 'json' } = req.query;

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    let data = {};

    switch (type) {
      case 'students':
        data = await User.find({ role: 'student', ...dateFilter })
          .select('-password')
          .populate('studentInfo');
        break;
      case 'applications':
        data = await Application.find(dateFilter)
          .populate('student', 'firstName lastName email studentInfo')
          .populate('job', 'title company');
        break;
      case 'jobs':
        data = await Job.find(dateFilter)
          .populate('postedBy', 'firstName lastName employerInfo');
        break;
      case 'feedback':
        data = await Feedback.find(dateFilter)
          .populate('student', 'firstName lastName')
          .populate('employer', 'firstName lastName employerInfo')
          .populate('job', 'title company');
        break;
      default:
        return res.status(400).json({
          message: 'Invalid export type'
        });
    }

    if (format === 'csv') {
      // Convert to CSV format
      const csv = convertToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.json({
        data,
        exportedAt: new Date(),
        totalRecords: data.length
      });
    }
  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({
      message: 'Failed to export data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Helper function to convert data to CSV
function convertToCSV(data) {
  if (!data || data.length === 0) return '';

  const headers = Object.keys(data[0].toObject ? data[0].toObject() : data[0]);
  const csvRows = [headers.join(',')];

  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

module.exports = router;
